const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reversals-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Raffle, Order, Chance, OrderEvent } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { createPurchase } = require('../src/services/purchases');

// ---- Mercado Pago simulado: un pago puede cambiar de estado después (reintegro, contracargo) ----
const payments = {};
let seq = 0;
mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];

function pay(order, { status = 'approved', amount = Number(order.amount) } = {}) {
  const id = String(++seq);
  payments[id] = { id, status, statusDetail: status, externalReference: order.id, amount };
  return id;
}
const change = (id, status, statusDetail) => Object.assign(payments[id], { status, statusDetail: statusDetail || status });

function webhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}-${Math.random()}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`)
    .set('x-request-id', reqId)
    .send({ type: 'payment', data: { id: paymentId } });
}

const buyer = { name: 'Juan Pérez', email: 'juan@test.com', phone: '2915555555', dni: '30111222' };
let auth, raffleId, courseId, packs;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sorteo Onix', prize: 'Onix 0km' });
  raffleId = r.body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active' });
  const c = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina básica').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'cocina.pdf');
  courseId = c.body.id;
  packs = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs;
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

// Compra de 5 chances ya acreditada
async function approvedOrder() {
  const { orderId } = await createPurchase({ raffleId, packId: packs.find((p) => p.chances === 5).id, courseId, buyer });
  const order = await Order.findByPk(orderId);
  const paymentId = pay(order);
  assert.equal((await webhook(paymentId)).status, 200);
  return { orderId, paymentId };
}

test('un reintegro anula la compra y sus números, con fecha y motivo', async () => {
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'refunded');
  assert.equal((await webhook(paymentId)).status, 200);

  const order = await Order.findByPk(orderId);
  assert.equal(order.status, 'refunded');
  assert.ok(order.voidedAt);
  assert.equal(order.voidReason, 'Pago reintegrado');
  const chances = await Chance.findAll({ where: { OrderId: orderId } });
  assert.equal(chances.length, 5);
  for (const c of chances) {
    assert.equal(c.status, 'void');
    assert.ok(c.voidedAt);
    assert.equal(c.voidReason, 'Pago reintegrado');
  }
});

test('un contracargo también anula los números', async () => {
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'charged_back');
  await webhook(paymentId);
  const order = await Order.findByPk(orderId);
  assert.equal(order.status, 'charged_back');
  assert.match(order.voidReason, /Contracargo/);
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'void' } }), 5);
});

test('repetir el aviso no duplica el historial ni cambia nada', async () => {
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'refunded');
  await webhook(paymentId);
  await webhook(paymentId);
  const events = await OrderEvent.findAll({ where: { OrderId: orderId }, order: [['id', 'ASC']] });
  assert.deepEqual(events.map((e) => e.status), ['approved', 'refunded']);
});

test('el historial muestra cada cambio de estado y pide sesión de admin', async () => {
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'refunded');
  await webhook(paymentId);
  assert.equal((await request(app).get(`/api/admin/orders/${orderId}/history`)).status, 401);
  const res = await request(app).get(`/api/admin/orders/${orderId}/history`).set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'refunded');
  assert.equal(res.body.voidedNumbers, 5);
  assert.deepEqual(res.body.events.map((e) => [e.status, e.mpPaymentId]), [['approved', paymentId], ['refunded', paymentId]]);
});

test('un reintegro parcial no anula nada', async () => {
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'approved', 'partially_refunded');
  await webhook(paymentId);
  assert.equal((await Order.findByPk(orderId)).status, 'approved');
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'valid' } }), 5);
});

test('el aviso de un pago que no acreditó la compra no la anula', async () => {
  const { orderId } = await approvedOrder();
  const order = await Order.findByPk(orderId);
  const otro = pay(order, { status: 'refunded' }); // otro intento de pago de la misma compra
  await webhook(otro);
  assert.equal((await Order.findByPk(orderId)).status, 'approved');
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'valid' } }), 5);
});

test('un reintegro de una compra que nunca se acreditó no hace nada', async () => {
  const { orderId } = await createPurchase({ raffleId, packId: packs.find((p) => p.chances === 5).id, courseId, buyer });
  const order = await Order.findByPk(orderId);
  await webhook(pay(order, { status: 'refunded' }));
  const after = await Order.findByPk(orderId);
  assert.equal(after.status, 'pending');
  assert.equal(await Chance.count({ where: { OrderId: orderId } }), 0);
});

test('un pago con monto distinto que se reintegra queda como reintegrado', async () => {
  const { orderId } = await createPurchase({ raffleId, packId: packs.find((p) => p.chances === 5).id, courseId, buyer });
  const order = await Order.findByPk(orderId);
  const paymentId = pay(order, { amount: 1 });
  await webhook(paymentId);
  assert.equal((await Order.findByPk(orderId)).status, 'needs_review');
  change(paymentId, 'refunded');
  await webhook(paymentId);
  assert.equal((await Order.findByPk(orderId)).status, 'refunded');
});

test('las compras anuladas no cuentan en ventas ni recaudación, y el panel las cuenta aparte', async () => {
  const before = (await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth)).body;
  const { paymentId } = await approvedOrder();
  const mid = (await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth)).body;
  assert.equal(mid.chancesSold, before.chancesSold + 5);
  change(paymentId, 'refunded');
  await webhook(paymentId);
  const after = (await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth)).body;
  assert.equal(after.chancesSold, before.chancesSold);
  assert.equal(after.revenue, before.revenue);
  assert.equal(after.reversed, before.reversed + 1);
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(pub.body.chancesSold, before.chancesSold);
});

test('la exportación CSV incluye las compras anuladas con su estado', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.match(res.text, /refunded/);
  assert.match(res.text, /charged_back/);
});

test('si se anula el número ya sorteado, el panel avisa y no se puede volver a elegir', async () => {
  const { orderId, paymentId } = await approvedOrder();
  const order = await Order.findByPk(orderId);
  const win = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: order.firstNumber });
  assert.equal(win.status, 200);
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth)).body.winnerVoided, false);
  change(paymentId, 'charged_back');
  await webhook(paymentId);
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth)).body.winnerVoided, true);
  const again = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: order.firstNumber });
  assert.equal(again.status, 409);
});

test('antes de dar un ganador se verifica el pago en MP: si ya fue reintegrado, se anula y no gana', async () => {
  await Raffle.update({ status: 'active', winnerNumber: null }, { where: { id: raffleId } }); // el test anterior ya sorteó
  const { orderId, paymentId } = await approvedOrder();
  change(paymentId, 'refunded'); // MP ya lo reintegró, pero el aviso todavía no llegó (no se llama al webhook)
  const order = await Order.findByPk(orderId);
  const res = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: order.firstNumber });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /anulado/);
  assert.equal((await Order.findByPk(orderId)).status, 'refunded');
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'void' } }), 5);
  const raffle = await request(app).get(`/api/raffles/${raffleId}`);
  assert.notEqual(raffle.body.winnerNumber, order.firstNumber);
});

test('si no se puede verificar el pago en MP, no se carga el ganador', async () => {
  const { orderId, paymentId } = await approvedOrder();
  const order = await Order.findByPk(orderId);
  const original = mp.getPayment;
  mp.getPayment = async () => { throw new Error('MP caído'); };
  try {
    const res = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: order.firstNumber });
    assert.equal(res.status, 503);
  } finally {
    mp.getPayment = original;
  }
  assert.equal((await Order.findByPk(orderId)).status, 'approved');
});
