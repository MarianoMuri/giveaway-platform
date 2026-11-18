const { Op } = require('sequelize');
const config = require('../config');
const { Order, Raffle } = require('../db');
const { mailer } = require('./mailer');
const { purchaseConfirmation } = require('./emailTemplates');
const courses = require('./courses');

/**
 * Envío del email de confirmación con el patrón "outbox":
 *
 * 1. Al aprobarse la compra, en la MISMA transacción se marca emailStatus = 'pending'.
 *    Si el servidor se cae justo después, el pendiente queda guardado y no se pierde.
 * 2. Después del commit se intenta enviar enseguida (deliver).
 * 3. Un proceso periódico (processPending) reintenta los que fallaron, con espera creciente.
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

// Intenta enviar el mail de una orden. Devuelve 'sent', 'retry', 'failed' o 'skipped'.
async function deliver(orderId) {
  if (!(await claim(orderId))) return 'skipped'; // ya enviado, no le toca todavía o lo tomó otro proceso
  const order = await Order.findByPk(orderId, { include: Raffle });
  try {
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

// Envío inmediato después del commit: nunca hace fallar al que lo llama
function deliverSoon(orderId) {
  return deliver(orderId).catch((err) => console.error('[mail] error inesperado', err));
}

// Proceso periódico: envía los pendientes a los que ya les toca
async function processPending(limit = 20) {
  const due = await Order.findAll({
    where: { emailStatus: 'pending', emailNextAttemptAt: { [Op.lte]: new Date() } },
    attributes: ['id'],
    order: [['emailNextAttemptAt', 'ASC']],
    limit,
  });
  const results = [];
  for (const { id } of due) results.push(await deliver(id));
  return results;
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

module.exports = { enqueue, deliver, deliverSoon, processPending, resend, hasEmail, RETRY_MINUTES, MAX_ATTEMPTS };
