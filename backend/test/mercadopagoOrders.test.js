const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-orders-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order, Chance } = require('../src/db');
const { mp, verifySignature, fromOrder, orderBody, isOrderId } = require('../src/services/mercadopago');

// ---- Mercado Pago simulado: ahora responde como la API de Orders ----
const orders = {};
let seq = 0;
mp.createCheckout = async ({ order }) => ({ id: `ORDCHK${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => fromOrder(orders[id]);

function payOrder(order, { status = 'processed', detail = 'accredited', amount = Number(order.amount) } = {}) {
  const id = `ORD0${String(++seq).padStart(6, '0')}X`;
  orders[id] = {
    id, status, status_detail: detail, external_reference: order.id,
    total_amount: amount.toFixed(2), total_paid_amount: status === 'processed' ? amount.toFixed(2) : '0.00',
  };
  return id;
}

function orderWebhook(id, { secret = 'secreto-test', lower = false } = {}) {
  const ts = String(Date.now());
  const reqId = `req-${id}`;
  const signedId = lower ? id.toLowerCase() : id;
  const v1 = crypto.createHmac('sha256', secret).update(`id:${signedId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app)
    .post(`/api/webhooks/mercadopago?data.id=${id}&type=order`)
    .set('x-signature', `ts=${ts},v1=${v1}`)
    .set('x-request-id', reqId)
    .send({ type: 'order', action: 'order.processed', data: { id } });
}

const buyer = { name: 'Ana García', email: 'ana@test.com', phone: '291 555-1234', dni: '31.222.333', province: 'B' };
let raffleId, courseId, packs;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sorteo Onix', prize: 'Onix 0km' });
  raffleId = r.body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  const c = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina básica').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'cocina.pdf');
  courseId = c.body.id;
  packs = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs;
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

const buy = (chances) => request(app).post(`/api/raffles/${raffleId}/purchases`)
  .send({ courseId, buyer, packId: packs.find((p) => p.chances === chances).id });

test('el estado de una orden se traduce al de un pago', () => {
  const o = (status, extra = {}) => fromOrder({ id: 'ORD1', status, total_amount: '1000.00', total_paid_amount: '0.00', external_reference: 'x', ...extra });
  assert.equal(o('processed', { total_paid_amount: '1000.00', status_detail: 'accredited' }).status, 'approved');
  assert.equal(o('processed', { total_paid_amount: '1000.00', status_detail: 'partially_refunded' }).status, 'approved');
  assert.equal(o('refunded').status, 'refunded');
  assert.equal(o('charged_back', { status_detail: 'in_process' }).status, 'charged_back');
  assert.equal(o('failed').status, 'rejected');
  assert.equal(o('expired').status, 'cancelled');
  assert.equal(o('canceled').status, 'cancelled');
  assert.equal(o('action_required').status, 'pending');
  assert.equal(o('estado_nuevo_que_no_conocemos').status, 'pending');
  // el monto es lo que se pagó; si todavía no hay pago, el de la orden
  assert.equal(o('processed', { total_paid_amount: '1000.00' }).amount, 1000);
  assert.equal(o('refunded').amount, 1000);
  assert.equal(o('processed', { total_paid_amount: '1000.00' }).externalReference, 'x');
});

test('el cuerpo de la orden usa montos con 2 decimales, un ítem y las URLs en config.online', () => {
  const b = orderBody({ order: { id: 'abc', amount: '65000', buyerEmail: 'ana@test.com' }, title: 'T'.repeat(300) });
  assert.equal(b.type, 'online');
  assert.equal(b.processing_mode, 'manual');
  assert.equal(b.total_amount, '65000.00');
  assert.equal(b.external_reference, 'abc');
  assert.equal(b.payer.email, 'ana@test.com');
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].unit_price, '65000.00');
  assert.equal(b.items[0].quantity, 1);
  assert.equal(b.items[0].title.length, 250);
  assert.match(b.config.online.success_url, /\/compra\/abc$/);
  assert.equal(b.config.online.auto_return, 'approved');
  // total = suma de los ítems (lo exige Mercado Pago)
  assert.equal(b.total_amount, b.items[0].unit_price);
});

test('se distinguen ids de orden y de pago', () => {
  assert.equal(isOrderId('ORD01M28P44G5FG8RJPM579EH56FV'), true);
  assert.equal(isOrderId('123456789'), false);
});

test('la firma de un aviso de orden se acepta con el id tal cual o en minúsculas, y no con otra clave', () => {
  const id = 'ORD01M28P44G5FG8RJPM579EH56FV';
  const sign = (signedId, secret = 'secreto-test') => {
    const ts = '1742505638683';
    const v1 = crypto.createHmac('sha256', secret).update(`id:${signedId};request-id:r1;ts:${ts};`).digest('hex');
    return { signatureHeader: `ts=${ts},v1=${v1}`, requestId: 'r1', dataId: id };
  };
  assert.equal(verifySignature(sign(id)), true);
  assert.equal(verifySignature(sign(id.toLowerCase())), true);
  assert.equal(verifySignature(sign(id, 'otra-clave')), false);
  assert.equal(verifySignature({ ...sign(id), dataId: 'ORDOTRO' }), false);
  assert.equal(verifySignature({ ...sign(id), signatureHeader: undefined }), false);
});

test('un aviso de orden acreditada confirma la compra y asigna los números', async () => {
  const res = await buy(5);
  assert.equal(res.status, 201);
  const order = await Order.findByPk(res.body.orderId);
  assert.equal(order.mpPreferenceId, `ORDCHK${order.id}`);

  const id = payOrder(order);
  assert.equal((await orderWebhook(id)).status, 200);
  await order.reload();
  assert.equal(order.status, 'approved');
  assert.equal(order.mpPaymentId, id);
  assert.equal(order.lastNumber - order.firstNumber + 1, 5);

  // el mismo aviso otra vez no duplica nada
  assert.equal((await orderWebhook(id)).status, 200);
  assert.equal(await Chance.count({ where: { OrderId: order.id } }), 5);
});

test('un aviso de orden con firma inválida no confirma nada', async () => {
  const order = await Order.findByPk((await buy(5)).body.orderId);
  const id = payOrder(order);
  assert.equal((await orderWebhook(id, { secret: 'otra' })).status, 401);
  await order.reload();
  assert.equal(order.status, 'pending');
});

test('una orden rechazada o con monto distinto no entrega números', async () => {
  const rejected = await Order.findByPk((await buy(5)).body.orderId);
  assert.equal((await orderWebhook(payOrder(rejected, { status: 'failed', detail: 'failed' }))).status, 200);
  await rejected.reload();
  assert.equal(rejected.status, 'pending'); // puede reintentar desde el mismo checkout
  assert.equal(rejected.firstNumber, null);

  const short = await Order.findByPk((await buy(5)).body.orderId);
  assert.equal((await orderWebhook(payOrder(short, { amount: 1 }))).status, 200);
  await short.reload();
  assert.equal(short.status, 'needs_review');
});

test('un reintegro de la orden anula los números', async () => {
  const order = await Order.findByPk((await buy(5)).body.orderId);
  const id = payOrder(order);
  await orderWebhook(id);
  await order.reload();
  assert.equal(order.status, 'approved');

  orders[id] = { ...orders[id], status: 'refunded', status_detail: 'refunded' };
  assert.equal((await orderWebhook(id)).status, 200);
  await order.reload();
  assert.equal(order.status, 'refunded');
  assert.equal(await Chance.count({ where: { OrderId: order.id, status: 'valid' } }), 0);
});

test('rechaza órdenes de prueba (ORDTST) salvo que ALLOW_MP_TEST esté activo', () => {
  const config = require('../src/config');
  const { assertLiveOrder, isTestOrderId } = require('../src/services/mercadopago');
  assert.equal(isTestOrderId('ORDTST01ABC'), true);
  assert.equal(isTestOrderId('ORD01ABC'), false);
  const before = config.mp.allowTest;
  try {
    config.mp.allowTest = false;
    assert.throws(() => assertLiveOrder('ORDTST01ABC'), /credenciales de prueba/);
    assert.doesNotThrow(() => assertLiveOrder('ORD01ABC'));
    config.mp.allowTest = true;
    assert.doesNotThrow(() => assertLiveOrder('ORDTST01ABC'));
  } finally {
    config.mp.allowTest = before;
  }
});
