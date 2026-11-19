const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'purchases-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Raffle, Order, Chance } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { handlePayment } = require('../src/services/orders');
const { createPurchase } = require('../src/services/purchases');
const { voidNumbers } = require('../src/services/numbers');

// ---- Mercado Pago simulado ----
const payments = {};
let paymentSeq = 0;
mp.createCheckout = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];

// Simula que el comprador pagó: registra el pago en "MP" y devuelve su id
function pay(order, { status = 'approved', amount = Number(order.amount) } = {}) {
  const id = String(++paymentSeq);
  payments[id] = { id, status, statusDetail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason', externalReference: order.id, amount };
  return id;
}

function signedWebhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`)
    .set('x-request-id', reqId)
    .send({ type: 'payment', data: { id: paymentId } });
}

// SQLite en memoria usa una sola conexión: no puede correr transacciones en paralelo.
// Los tests de concurrencia corren contra PostgreSQL (job "Backend · PostgreSQL" del CI).
const onlyPostgres = sequelize.getDialect() === 'postgres' ? false : 'requiere PostgreSQL (SQLite no admite transacciones concurrentes)';

const buyer = { name: 'Juan Pérez', email: 'Juan@Test.com ', phone: '291 555-5555', dni: '30.111.222', province: 'B' };
let auth, raffleId, courseId, packs;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Sorteo Onix', prize: 'Onix 0km' });
  raffleId = r.body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  const c = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina básica').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'cocina.pdf');
  courseId = c.body.id;
  packs = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs; // escalera sugerida
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

const pack = (chances) => packs.find((p) => p.chances === chances);
const buy = (body) => request(app).post(`/api/raffles/${raffleId}/purchases`).send({ courseId, buyer, ...body });

test('crear una compra devuelve el link de pago y todavía no asigna números', async () => {
  const res = await buy({ packId: pack(20).id, double: true });
  assert.equal(res.status, 201);
  assert.match(res.body.checkoutUrl, /^https:\/\/mp\.test\/checkout\//);
  assert.deepEqual([res.body.chances, res.body.total], [40, 65000]);

  const order = await Order.findByPk(res.body.orderId);
  assert.equal(order.status, 'pending');
  assert.equal(order.firstNumber, null);
  assert.equal(order.courseTitle, 'Cocina básica');
  assert.deepEqual([order.buyerEmail, order.buyerPhone, order.buyerDni], ['juan@test.com', '2915555555', '30111222']);
  assert.equal(await Chance.count(), 0);
});

test('valida los datos de la compra', async () => {
  const cases = [
    [{ packId: pack(5).id, buyer: { ...buyer, email: 'no-es-email' } }, 400, /email/],
    [{ packId: pack(5).id, buyer: { ...buyer, dni: '12' } }, 400, /DNI/],
    [{ packId: pack(5).id, courseId: 9999 }, 400, /curso/],
    [{ packId: 9999 }, 400, /Pack inválido/],
  ];
  for (const [body, status, msg] of cases) {
    const res = await buy(body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.body.error, msg);
  }
});

test('el pago aprobado asigna un bloque consecutivo desde 100000', async () => {
  const order = await Order.findOne({ where: { chances: 40 } });
  const res = await signedWebhook(pay(order));
  assert.equal(res.status, 200);

  await order.reload();
  assert.equal(order.status, 'approved');
  assert.deepEqual([order.firstNumber, order.lastNumber], [100000, 100039]);
  const nums = (await Chance.findAll({ where: { OrderId: order.id }, order: [['number', 'ASC']] })).map((c) => c.number);
  assert.equal(nums.length, 40);
  assert.ok(nums.every((n, i) => n === 100000 + i));

  const pub = await request(app).get(`/api/orders/${order.id}`);
  assert.deepEqual([pub.body.firstNumber, pub.body.lastNumber, pub.body.chances], [100000, 100039, 40]);
});

test('un aviso repetido de Mercado Pago no asigna números de nuevo', async () => {
  const order = await Order.findOne({ where: { chances: 40 } });
  const before = (await Raffle.findByPk(raffleId)).nextNumber;
  const res = await signedWebhook(order.mpPaymentId);
  assert.equal(res.status, 200);
  assert.equal(await Chance.count({ where: { OrderId: order.id } }), 40);
  assert.equal((await Raffle.findByPk(raffleId)).nextNumber, before);
});

test('la compra siguiente continúa donde terminó la anterior', async () => {
  const { orderId } = (await buy({ packId: pack(5).id })).body;
  const order = await Order.findByPk(orderId);
  await signedWebhook(pay(order));
  await order.reload();
  assert.deepEqual([order.firstNumber, order.lastNumber], [100040, 100044]);
});

test('un pago rechazado no asigna números y se puede reintentar', async () => {
  const { orderId } = (await buy({ packId: pack(10).id })).body;
  const order = await Order.findByPk(orderId);
  await signedWebhook(pay(order, { status: 'rejected' }));
  await order.reload();
  assert.equal(order.status, 'pending');
  assert.equal(await Chance.count({ where: { OrderId: order.id } }), 0);

  await signedWebhook(pay(order)); // reintento con otra tarjeta
  await order.reload();
  assert.equal(order.status, 'approved');
  assert.deepEqual([order.firstNumber, order.lastNumber], [100045, 100054]);
});

test('si el monto pagado no coincide, la compra queda para revisar y sin números', async () => {
  const { orderId } = (await buy({ packId: pack(5).id })).body;
  const order = await Order.findByPk(orderId);
  await signedWebhook(pay(order, { amount: 1 }));
  await order.reload();
  assert.equal(order.status, 'needs_review');
  assert.equal(await Chance.count({ where: { OrderId: order.id } }), 0);
});

test('un webhook sin firma válida no confirma nada', async () => {
  const { orderId } = (await buy({ packId: pack(5).id })).body;
  const order = await Order.findByPk(orderId);
  const res = await request(app).post(`/api/webhooks/mercadopago?data.id=${pay(order)}&type=payment`)
    .set('x-signature', 'ts=1,v1=falsa').set('x-request-id', 'x').send({});
  assert.equal(res.status, 401);
  assert.equal((await order.reload()).status, 'pending');
});

test('pagos simultáneos nunca reciben números repetidos', { skip: onlyPostgres }, async () => {
  const start = (await Raffle.findByPk(raffleId)).nextNumber;
  const sizes = [5, 10, 20, 30, 50, 100, 5, 10, 20, 30, 50, 100, 5, 10, 20, 30, 50, 100, 5, 10];
  // Se crean por el servicio (no por HTTP) para no chocar con el rate limit de compras
  const orders = await Promise.all(sizes.map((n, i) => createPurchase({
    raffleId, packId: pack(n).id, double: i % 3 === 0, courseId, buyer: { ...buyer, dni: String(20000000 + i) },
  })));
  const rows = await Order.findAll({ where: { id: orders.map((o) => o.orderId) } });
  const ids = rows.map((o) => pay(o));

  // Todos los avisos llegan a la vez
  await Promise.all(ids.map((id) => handlePayment(id)));

  const done = await Order.findAll({ where: { id: orders.map((o) => o.orderId) } });
  assert.ok(done.every((o) => o.status === 'approved'));
  const expected = done.reduce((a, o) => a + o.chances, 0);
  const nums = (await Chance.findAll({ where: { OrderId: done.map((o) => o.id) } })).map((c) => c.number).sort((a, b) => a - b);
  assert.equal(nums.length, expected);
  assert.equal(new Set(nums).size, expected, 'hay números repetidos');
  // Los bloques son consecutivos y sin huecos entre sí
  assert.ok(nums.every((n, i) => n === start + i));
  for (const o of done) assert.equal(o.lastNumber - o.firstNumber + 1, o.chances);
  assert.equal((await Raffle.findByPk(raffleId)).nextNumber, start + expected);
});

test('el mismo aviso procesado varias veces a la vez asigna una sola vez', { skip: onlyPostgres }, async () => {
  const { orderId } = await createPurchase({ raffleId, packId: pack(10).id, courseId, buyer });
  const order = await Order.findByPk(orderId);
  const id = pay(order);
  await Promise.all([handlePayment(id), handlePayment(id), handlePayment(id), handlePayment(id)]);
  assert.equal(await Chance.count({ where: { OrderId: orderId } }), 10);
});

test('los números anulados no se reutilizan', async () => {
  const anulled = await Order.findOne({ where: { chances: 5, status: 'approved' } });
  assert.equal(await voidNumbers(anulled.id), 5);
  const last = (await Raffle.findByPk(raffleId)).nextNumber;

  const { orderId } = await createPurchase({ raffleId, packId: pack(5).id, courseId, buyer });
  await handlePayment(pay(await Order.findByPk(orderId)));
  const order = await Order.findByPk(orderId);
  assert.equal(order.firstNumber, last);
  assert.ok(order.firstNumber > anulled.lastNumber);
  assert.equal(await Chance.count({ where: { OrderId: anulled.id, status: 'void' } }), 5);
});

test('la base rechaza un número duplicado aunque falle la lógica', async () => {
  const c = await Chance.findOne();
  await assert.rejects(Chance.create({ number: c.number, RaffleId: c.RaffleId }));
});

test('cada sorteo numera por separado desde 100000', async () => {
  const r = await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Otro', prize: 'Moto' });
  await request(app).patch(`/api/admin/raffles/${r.body.id}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  const p5 = (await request(app).get(`/api/raffles/${r.body.id}/packs`)).body.packs[0];
  const { orderId } = await createPurchase({ raffleId: r.body.id, packId: p5.id, courseId, buyer });
  await handlePayment(pay(await Order.findByPk(orderId)));
  assert.equal((await Order.findByPk(orderId)).firstNumber, 100000);
});

test('un curso con compras no se puede eliminar', async () => {
  const res = await request(app).delete(`/api/admin/courses/${courseId}`).set(auth);
  assert.equal(res.status, 409);
});
