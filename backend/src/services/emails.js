const { Op } = require('sequelize');
const config = require('../config');
const { Order, Raffle } = require('../db');
const { mailer } = require('./mailer');
const { purchaseConfirmation } = require('./emailTemplates');
const courses = require('./courses');
const { createLimiter } = require('./rateLimiter');

/**
 * Envío del email de confirmación con el patrón "outbox":
 *
 * 1. Al aprobarse la compra, en la MISMA transacción se marca emailStatus = 'pending'.
 *    Si el servidor se cae justo después, el pendiente queda guardado y no se pierde.
 * 2. Después del commit se intenta enviar enseguida (deliver).
 * 3. Un proceso periódico (processPending) reintenta los que fallaron, con espera creciente.
 *
 * Para volumen alto el envío lo hace un worker (puede ser un servicio aparte de la API) que toma los
 * pendientes por lotes, con varios envíos en paralelo y sin superar el límite por segundo del proveedor.
 * Un pico de compras solo agranda la cola: no demora las respuestas del sitio.
 *
 * Cada envío "toma" la orden con un UPDATE condicional (claim): si dos procesos intentan
 * mandar el mismo mail a la vez, solo uno lo consigue. Así no se duplican mails.
 */

const RETRY_MINUTES = [1, 5, 15, 60, 360]; // espera antes de cada reintento
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const LEASE_MINUTES = 2; // mientras se envía, la orden queda tomada este tiempo

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hasEmail = (order) => EMAIL.test(String(order.buyerEmail || ''));
const minutesFromNow = (m) => new Date(Date.now() + m * 60 * 1000);

// Marca la orden para enviar el mail (llamar dentro de la transacción que la aprueba)
async function enqueue(order, transaction) {
  if (!hasEmail(order)) return order.update({ emailStatus: 'none' }, { transaction });
  return order.update(
    { emailStatus: 'pending', emailAttempts: 0, emailNextAttemptAt: new Date(), emailLastError: null },
    { transaction }
  );
}

async function claim(orderId) {
  const [count] = await Order.update(
    { emailNextAttemptAt: minutesFromNow(LEASE_MINUTES), emailAttempts: Order.sequelize.literal('"emailAttempts" + 1') },
    { where: { id: orderId, emailStatus: 'pending', emailNextAttemptAt: { [Op.lte]: new Date() } } }
  );
  return count === 1;
}

function build(order, raffle) {
  const hours = config.downloadLinkHours;
  return purchaseConfirmation({
    order,
    raffle,
    brand: config.brand,
    downloadUrl: order.CourseId ? courses.downloadUrl(order.CourseId, hours) : null,
    orderUrl: `${config.frontendUrl}/compra/${order.id}`,
    linkHours: hours,
  });
}

// Límite de velocidad compartido por todos los envíos de este proceso
let limiter;
function getLimiter() {
  if (!limiter || limiter.perSecond !== config.email.ratePerSecond) limiter = createLimiter({ perSecond: config.email.ratePerSecond });
  return limiter;
}
const resetLimiter = () => {
  limiter = null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Intenta enviar el mail de una orden. Devuelve 'sent', 'retry', 'failed' o 'skipped'.
// "throttle" espera el turno del límite de velocidad, ya con la orden tomada.
async function deliver(orderId, { throttle } = {}) {
  if (!(await claim(orderId))) return 'skipped'; // ya enviado, no le toca todavía o lo tomó otro proceso
  const order = await Order.findByPk(orderId, { include: Raffle });
  try {
    if (throttle) await throttle();
    const mail = build(order, order.Raffle);
    await mailer.send({ to: order.buyerEmail, ...mail });
    await order.update({ emailStatus: 'sent', emailSentAt: new Date(), emailNextAttemptAt: null, emailLastError: null });
    return 'sent';
  } catch (err) {
    const attempts = order.emailAttempts;
    const failed = attempts >= MAX_ATTEMPTS;
    await order.update({
      emailStatus: failed ? 'failed' : 'pending',
      emailNextAttemptAt: failed ? null : minutesFromNow(RETRY_MINUTES[attempts - 1]),
      emailLastError: String(err.message || err).slice(0, 500),
    });
    console.error(`[mail] falló el envío de la orden ${orderId} (intento ${attempts}):`, err.message);
    return failed ? 'failed' : 'retry';
  }
}

// Envío inmediato después del commit: nunca hace fallar al que lo llama. Si ya hay una cola larga
// (pico de compras) o el envío está a cargo de un worker aparte, no lo intenta: el mail queda
// pendiente y lo manda el worker, sin cargar a la API.
function deliverSoon(orderId) {
  if (!config.email.immediate) return Promise.resolve('deferred');
  const wait = getLimiter().reserve(config.email.immediateMaxWaitMs);
  if (wait === null) return Promise.resolve('deferred');
  return deliver(orderId, { throttle: () => sleep(wait) }).catch((err) => {
    console.error('[mail] error inesperado', err);
    return 'error';
  });
}

// Procesa en paralelo (hasta "concurrency" a la vez) una lista de tareas
async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      results[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Un lote: toma hasta "limit" pendientes a los que ya les toca y los envía respetando el límite de velocidad
async function processPending(limit = config.email.batchSize) {
  const due = await Order.findAll({
    where: { emailStatus: 'pending', emailNextAttemptAt: { [Op.lte]: new Date() } },
    attributes: ['id'],
    order: [['emailNextAttemptAt', 'ASC']],
    limit,
  });
  return runPool(due, config.email.concurrency, ({ id }) => deliver(id, { throttle: () => getLimiter().acquire() }));
}

// Vacía la cola lote por lote. Corta si pasó maxMs (para volver a mirar y apagarse con orden) o si
// los pendientes que quedan los tiene tomados otro proceso.
async function drain({ maxMs = 55 * 1000 } = {}) {
  const summary = { sent: 0, retry: 0, failed: 0, skipped: 0 };
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const results = await processPending();
    for (const r of results) summary[r] += 1;
    const worked = results.filter((r) => r !== 'skipped').length;
    if (!worked || results.length < config.email.batchSize) break;
  }
  return summary;
}

// Worker: cada pocos segundos vacía la cola. Corre dentro de la API (desarrollo) o en un servicio aparte.
function startWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await drain();
      if (s.sent + s.retry + s.failed) console.log(`[mail] lote: ${s.sent} enviados, ${s.retry} a reintentar, ${s.failed} fallidos`);
    } catch (e) {
      console.error('[mail] worker', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.email.pollSeconds * 1000);
  timer.unref?.();
  setTimeout(tick, 1000).unref?.();
  return { stop: () => clearInterval(timer) };
}

// "Reenviar todos los fallidos" del sorteo: los vuelve a poner en cola; el worker los manda al ritmo permitido
async function retryFailed(raffleId) {
  const [count] = await Order.update(
    { emailStatus: 'pending', emailAttempts: 0, emailNextAttemptAt: new Date(), emailLastError: null },
    { where: { RaffleId: raffleId, emailStatus: 'failed' } }
  );
  return count;
}

// Reenvío manual desde el panel (opcionalmente a un email corregido)
async function resend(order, email) {
  const changes = { emailStatus: 'pending', emailAttempts: 0, emailNextAttemptAt: new Date(), emailLastError: null };
  if (email !== undefined) changes.buyerEmail = String(email).trim().toLowerCase();
  await order.update(changes);
  if (!hasEmail(order)) {
    await order.update({ emailStatus: 'none' });
    return 'skipped';
  }
  return deliver(order.id);
}

module.exports = { enqueue, deliver, deliverSoon, processPending, drain, startWorker, retryFailed, resetLimiter, resend, hasEmail, RETRY_MINUTES, MAX_ATTEMPTS };
