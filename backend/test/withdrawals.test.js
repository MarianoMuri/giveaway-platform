const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'withdrawals-test-'));
process.env.PUBLIC_API_URL = 'http://api.test';
process.env.FRONTEND_URL = 'http://web.test';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order, Chance, Withdrawal } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const { createPurchase, confirmPackOrder } = require('../src/services/purchases');

mp.createCheckout = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/${order.id}` });
let refunds = [];
let refundFails = false;
mp.refund = async (id, key) => { if (refundFails) throw new Error('sin saldo'); refunds.push({ id, key }); return {}; };
let sent = [];
mailer.send = async (msg) => { sent.push(msg); return { id: `m-${sent.length}` }; };

const PDF = Buffer.from('%PDF-1.4\ncurso\n%%EOF');
const buyer = (email, dni = '30111222') => ({ name: 'Ana Gómez', email, phone: '2914555555', dni, province: 'B' });
let auth, raffleId, courseId, packId;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  raffleId = (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Gran Sorteo', prize: 'Onix 0km', drawDate: '2026-12-08T00:00:00.000Z' })).body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  courseId = (await request(app).post('/api/admin/courses').set(auth).field('title', 'Cocina básica').attach('pdf', PDF, 'cocina.pdf')).body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 20).id;
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));
test.beforeEach(() => { sent = []; refunds = []; refundFails = false; });

async function paid(email, dni) {
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: buyer(email, dni) });
  const order = await Order.findByPk(orderId);
  await sequelize.transaction((t) => confirmPackOrder(order, { amount: Number(order.amount), id: `pay-${orderId}`, status: 'approved' }, t));
  return Order.findByPk(orderId);
}
const withdrawals = require('../src/services/withdrawals');
const ask = (dni, email) => withdrawals.request({ dni, email }); // directo: el límite por IP de la ruta es de 8 pedidos cada 15 minutos
const askHttp = (dni, email) => request(app).post('/api/withdrawals').send({ dni, email });

test('el pedido responde igual exista o no la compra y solo manda constancia si coincide', async () => {
  const order = await paid('ana@test.com', '30111222');
  const hit = await askHttp('30111222', ' ANA@test.com ');
  const miss = await askHttp('30999888', 'nadie@test.com');
  assert.equal(hit.status, 202);
  assert.deepEqual(miss.body, hit.body);
  const toBuyer = sent.filter((m) => m.to === 'ana@test.com');
  assert.equal(toBuyer.length, 1);
  assert.match(toBuyer[0].subject, /ARR-/);
  assert.equal(sent.filter((m) => m.to === 'nadie@test.com').length, 0);
  assert.equal((await Withdrawal.findAll({ where: { OrderId: order.id } })).length, 1);
});

test('validación y sin duplicados mientras haya uno pendiente', async () => {
  assert.equal((await askHttp('12', 'a@b.com')).status, 400);
  assert.equal((await askHttp('30111222', 'sin-arroba')).status, 400);
  await paid('dup@test.com', '30222333');
  await ask('30222333', 'dup@test.com');
  await ask('30222333', 'dup@test.com');
  assert.equal(await Withdrawal.count({ where: { dni: '30222333' } }), 1);
});

test('aprobar devuelve el dinero por Mercado Pago, anula los números y avisa', async () => {
  const order = await paid('ok@test.com', '30333444');
  await ask('30333444', 'ok@test.com');
  const w = (await request(app).get('/api/admin/withdrawals?status=pending').set(auth)).body.find((x) => x.order?.id === order.id);
  assert.equal(w.order.chances, 20);
  sent = [];
  const res = await request(app).post(`/api/admin/withdrawals/${w.id}/approve`).set(auth);
  assert.equal(res.status, 200);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].id, order.mpPaymentId);
  const after = await Order.findByPk(order.id);
  assert.equal(after.status, 'refunded');
  assert.equal(await Chance.count({ where: { OrderId: order.id, status: 'valid' } }), 0);
  assert.equal(await Chance.count({ where: { OrderId: order.id, status: 'void' } }), 20);
  assert.ok(sent.some((m) => m.to === 'ok@test.com' && /aceptado/.test(m.subject)));
  // no se puede devolver dos veces
  assert.equal((await request(app).post(`/api/admin/withdrawals/${w.id}/approve`).set(auth)).status, 409);
  assert.equal(refunds.length, 1);
});

test('si Mercado Pago falla no se anula nada y la solicitud sigue pendiente', async () => {
  const order = await paid('falla@test.com', '30444555');
  await ask('30444555', 'falla@test.com');
  const w = await Withdrawal.findOne({ where: { OrderId: order.id } });
  refundFails = true;
  const res = await request(app).post(`/api/admin/withdrawals/${w.id}/approve`).set(auth);
  assert.equal(res.status, 502);
  assert.equal((await Order.findByPk(order.id)).status, 'approved');
  assert.equal(await Chance.count({ where: { OrderId: order.id, status: 'valid' } }), 20);
  assert.equal((await Withdrawal.findByPk(w.id)).status, 'pending');
});

test('rechazar pide un motivo, deja la compra y avisa al comprador', async () => {
  const order = await paid('no@test.com', '30555666');
  await ask('30555666', 'no@test.com');
  const w = await Withdrawal.findOne({ where: { OrderId: order.id } });
  assert.equal((await request(app).post(`/api/admin/withdrawals/${w.id}/reject`).set(auth).send({})).status, 400);
  sent = [];
  const res = await request(app).post(`/api/admin/withdrawals/${w.id}/reject`).set(auth).send({ note: 'Ya descargó y usó el curso' });
  assert.equal(res.status, 200);
  assert.equal((await Order.findByPk(order.id)).status, 'approved');
  assert.equal((await Withdrawal.findByPk(w.id)).status, 'rejected');
  assert.ok(sent.some((m) => m.to === 'no@test.com' && /Ya descargó/.test(m.text)));
});

test('un pedido sin compra asociada no se puede aprobar', async () => {
  await ask('30777888', 'fantasma@test.com');
  const w = await Withdrawal.findOne({ where: { dni: '30777888' } });
  assert.equal(w.OrderId, null);
  assert.equal((await request(app).post(`/api/admin/withdrawals/${w.id}/approve`).set(auth)).status, 409);
});

test('la lista del panel exige sesión', async () => {
  assert.equal((await request(app).get('/api/admin/withdrawals')).status, 401);
});
