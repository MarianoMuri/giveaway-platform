process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Raffle, Order } = require('../src/db');
const { mailer } = require('../src/services/mailer');
const emails = require('../src/services/emails');
const { createLimiter } = require('../src/services/rateLimiter');

let sent = [];
let inFlight = 0;
let maxInFlight = 0;
let sendDelayMs = 0;
let failNext = 0;
mailer.send = async (msg) => {
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    if (sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('SMTP rechazó el mensaje');
    }
    sent.push({ to: msg.to, at: Date.now() });
    return { id: 'm' };
  } finally {
    inFlight -= 1;
  }
};

let raffle;
let seq = 0;
async function pendingOrders(n, overrides = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    seq += 1;
    out.push(await Order.create({
      RaffleId: (overrides.raffle || raffle).id, buyerName: `Comprador ${seq}`, buyerEmail: `c${seq}@test.com`, buyerPhone: '1', buyerDni: String(30000000 + seq),
      amount: 1000, status: 'approved', chances: 1, firstNumber: 100000 + seq, lastNumber: 100000 + seq,
      emailStatus: 'pending', emailAttempts: 0, emailNextAttemptAt: new Date(Date.now() - 1000), ...overrides.fields,
    }));
  }
  return out;
}
const count = (where) => Order.count({ where });

test.before(async () => {
  await sequelize.sync();
});
test.beforeEach(async () => {
  await Order.destroy({ where: {} });
  raffle = await Raffle.create({ title: 'Sorteo', prize: 'Auto', status: 'active' });
  sent = [];
  inFlight = 0;
  maxInFlight = 0;
  sendDelayMs = 0;
  failNext = 0;
  Object.assign(config.email, { batchSize: 50, concurrency: 5, ratePerSecond: 0, immediate: true });
  emails.resetLimiter();
});

// ---- Limitador de velocidad (reloj simulado, sin esperas reales) ----

test('el limitador separa los turnos según el límite por segundo', () => {
  let t = 1000;
  const l = createLimiter({ perSecond: 10, now: () => t });
  assert.deepEqual([l.reserve(), l.reserve(), l.reserve()], [0, 100, 200]);
  t += 1000; // pasó un segundo: la cola se vació
  assert.equal(l.reserve(), 0);
});

test('con demasiada cola, el limitador no reserva y avisa', () => {
  const l = createLimiter({ perSecond: 1, now: () => 0 });
  assert.equal(l.reserve(2000), 0);
  assert.equal(l.reserve(2000), 1000);
  assert.equal(l.reserve(2000), 2000);
  assert.equal(l.reserve(2000), null, 'el cuarto tendría que esperar 3 s');
  assert.equal(l.reserve(5000), 3000, 'sin reservar antes, el turno sigue libre');
});

test('sin límite (0) nunca espera', async () => {
  const l = createLimiter({ perSecond: 0, now: () => 0, sleep: async () => assert.fail('no debe dormir') });
  for (let i = 0; i < 50; i++) assert.equal(l.reserve(0), 0);
  await l.acquire();
});

// ---- Lotes ----

test('lote parcial: toma solo el tamaño pedido y el resto queda pendiente', async () => {
  await pendingOrders(7);
  const first = await emails.processPending(3);
  assert.equal(first.length, 3);
  assert.equal(sent.length, 3);
  assert.equal(await count({ emailStatus: 'pending' }), 4);
  assert.equal((await emails.processPending(3)).length, 3);
  assert.equal((await emails.processPending(3)).length, 1);
  assert.equal(await count({ emailStatus: 'sent' }), 7);
});

test('el lote respeta el tamaño configurado', async () => {
  config.email.batchSize = 4;
  await pendingOrders(10);
  assert.equal((await emails.processPending()).length, 4);
});

test('drain vacía la cola en varios lotes', async () => {
  config.email.batchSize = 5;
  await pendingOrders(12);
  const s = await emails.drain();
  assert.equal(s.sent, 12);
  assert.equal(await count({ emailStatus: 'pending' }), 0);
});

test('los envíos de un lote van en paralelo, sin pasar el máximo configurado', async () => {
  config.email.concurrency = 4;
  sendDelayMs = 30;
  await pendingOrders(12);
  await emails.processPending();
  assert.equal(sent.length, 12);
  assert.ok(maxInFlight > 1, 'hubo envíos simultáneos');
  assert.ok(maxInFlight <= 4, `nunca más de 4 a la vez (hubo ${maxInFlight})`);
});

test('el ritmo de envío no supera el límite del proveedor', async () => {
  config.email.ratePerSecond = 50; // un envío cada 20 ms
  emails.resetLimiter();
  await pendingOrders(10);
  const t0 = Date.now();
  await emails.processPending();
  const elapsed = Date.now() - t0;
  assert.equal(sent.length, 10);
  assert.ok(elapsed >= 9 * 20 * 0.8, `10 envíos a 50/s tardan al menos ~180 ms (tardaron ${elapsed})`);
});

// ---- Sin duplicados ni pérdidas ----

test('reintento sin duplicados: varios procesos a la vez mandan cada mail una sola vez', async () => {
  sendDelayMs = 10;
  const orders = await pendingOrders(15);
  await Promise.all([emails.drain(), emails.drain(), emails.processPending(), ...orders.slice(0, 5).map((o) => emails.deliver(o.id))]);
  const recipients = sent.map((s) => s.to).sort();
  assert.equal(recipients.length, 15);
  assert.equal(new Set(recipients).size, 15, 'ningún destinatario recibió dos veces');
  assert.equal(await count({ emailStatus: 'sent' }), 15);
});

test('un envío que falla queda para reintentar con espera y no frena al resto del lote', async () => {
  const orders = await pendingOrders(6);
  failNext = 2;
  const results = await emails.processPending();
  assert.equal(results.filter((r) => r === 'sent').length, 4);
  assert.equal(results.filter((r) => r === 'retry').length, 2);
  const retrying = await Order.findAll({ where: { emailStatus: 'pending' } });
  assert.equal(retrying.length, 2);
  assert.ok(retrying.every((o) => o.emailNextAttemptAt > new Date() && o.emailAttempts === 1 && o.emailLastError));
  assert.equal((await emails.processPending()).length, 0, 'todavía no les toca');
  assert.equal(orders.length, 6);
});

// ---- Pico de compras: el envío inmediato no carga a la API ----

test('con cola larga, el envío inmediato se deja para el worker', async () => {
  Object.assign(config.email, { ratePerSecond: 10, immediateMaxWaitMs: 250 }); // turnos cada 100 ms
  emails.resetLimiter();
  const orders = await pendingOrders(6);
  // Los tres primeros entran (esperas de 0, 100 y 200 ms); el cuarto tendría que esperar 300 ms
  const accepted = orders.slice(0, 3).map((o) => emails.deliverSoon(o.id));
  assert.equal(await emails.deliverSoon(orders[3].id), 'deferred');
  assert.equal(await emails.deliverSoon(orders[4].id), 'deferred');
  assert.deepEqual(await Promise.all(accepted), ['sent', 'sent', 'sent']);
  assert.equal(await count({ emailStatus: 'pending' }), 3, 'los diferidos quedan pendientes, sin perderse');
  config.email.immediateMaxWaitMs = 2000;
  assert.equal((await emails.drain()).sent, 3, 'y el worker los envía');
});

test('con EMAIL_IMMEDIATE=off la API solo encola y el worker envía', async () => {
  config.email.immediate = false;
  const [order] = await pendingOrders(1);
  assert.equal(await emails.deliverSoon(order.id), 'deferred');
  assert.equal(sent.length, 0);
  assert.equal((await emails.drain()).sent, 1);
});

// ---- Reenviar todos los fallidos ----

test('"Reenviar todos los fallidos": solo los de ese sorteo, y se envían de a poco', async () => {
  const other = await Raffle.create({ title: 'Otro', prize: 'Moto', status: 'active' });
  await pendingOrders(5, { fields: { emailStatus: 'failed', emailAttempts: 6, emailNextAttemptAt: null, emailLastError: 'SMTP caído' } });
  await pendingOrders(2, { fields: { emailStatus: 'sent' } });
  await pendingOrders(3, { raffle: other, fields: { emailStatus: 'failed', emailAttempts: 6, emailNextAttemptAt: null } });

  assert.equal(await emails.retryFailed(raffle.id), 5);
  assert.equal(await count({ RaffleId: raffle.id, emailStatus: 'pending', emailAttempts: 0, emailLastError: null }), 5);
  assert.equal(await count({ RaffleId: other.id, emailStatus: 'failed' }), 3, 'los de otro sorteo no se tocan');
  assert.equal(await count({ RaffleId: raffle.id, emailStatus: 'sent' }), 2);

  assert.equal((await emails.drain()).sent, 5);
  assert.equal(sent.length, 5);
});

test('panel: el reenvío masivo exige sesión, cuenta pendientes y fallidos y queda registrado', async () => {
  await pendingOrders(3, { fields: { emailStatus: 'failed', emailAttempts: 6, emailNextAttemptAt: null } });
  await pendingOrders(2);
  const url = `/api/admin/raffles/${raffle.id}/emails/retry-failed`;
  assert.equal((await request(app).post(url)).status, 401);

  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  let stats = (await request(app).get(`/api/admin/raffles/${raffle.id}/stats`).set(auth)).body;
  assert.equal(stats.emailsFailed, 3);
  assert.equal(stats.emailsPending, 2);

  const res = await request(app).post(url).set(auth);
  assert.deepEqual(res.body, { requeued: 3 });
  stats = (await request(app).get(`/api/admin/raffles/${raffle.id}/stats`).set(auth)).body;
  assert.equal(stats.emailsFailed, 0);
  assert.equal(stats.emailsPending, 5);

  const log = (await request(app).get('/api/admin/audit').set(auth)).body;
  assert.ok(log.some((l) => l.action === 'emails.retry_failed' && /3 emails/.test(l.detail)));
});
