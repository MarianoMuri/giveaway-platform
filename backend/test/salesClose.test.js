const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salesclose-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Raffle, Order, Chance } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { createPurchase } = require('../src/services/purchases');

const payments = {}; // id -> pago
const byOrder = {}; // orderId -> [pagos] (lo que devuelve la búsqueda de MP)
let seq = 0;
mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];
mp.searchPayments = async (orderId) => (byOrder[orderId] || []).map((p) => ({ id: p.id, status: p.status }));

function pay(order, status = 'approved') {
  const id = String(++seq);
  payments[id] = { id, status, statusDetail: status, externalReference: order.id, amount: Number(order.amount) };
  (byOrder[order.id] ||= []).push(payments[id]);
  return id;
}
function webhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app).post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', reqId).send({ type: 'payment', data: { id: paymentId } });
}

const buyer = { name: 'Juan Pérez', email: 'juan@test.com', phone: '2915555555', dni: '30111222' };
const past = () => new Date(Date.now() - 60000).toISOString();
const future = () => new Date(Date.now() + 3600000).toISOString();
let auth, raffleId, courseId, packId;

const setRaffle = (changes) => Raffle.update(changes, { where: { id: raffleId } });
const purchase = () => createPurchase({ raffleId, packId, courseId, buyer });
const readiness = () => request(app).post(`/api/admin/raffles/${raffleId}/readiness`).set(auth);

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
  const packs = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs;
  packId = packs.find((p) => p.chances === 5).id;
});
test.beforeEach(() => setRaffle({ status: 'active', salesCloseAt: null, winnerNumber: null }));
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('con fecha de cierre futura la venta sigue abierta y la página pública lo informa', async () => {
  await setRaffle({ salesCloseAt: future() });
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(pub.body.salesOpen, true);
  assert.ok(pub.body.salesCloseAt);
  await assert.doesNotReject(purchase());
});

test('pasada la fecha de cierre no se puede comprar ni sumar participación gratuita', async () => {
  await setRaffle({ salesCloseAt: past() });
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(pub.body.salesOpen, false);
  await assert.rejects(purchase(), /ya cerró/);
  const quote = await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId });
  assert.equal(quote.status, 409);
  const free = await request(app).post(`/api/raffles/${raffleId}/free-entries`)
    .send({ name: 'Marta Ruiz', dni: '27111222', email: 'marta@test.com', deviceId: 'a'.repeat(32) });
  assert.equal(free.status, 409);
});

test('una compra iniciada antes del cierre y acreditada después se respeta', async () => {
  const { orderId } = await purchase();
  await setRaffle({ salesCloseAt: past() });
  const paymentId = pay(await Order.findByPk(orderId));
  assert.equal((await webhook(paymentId)).status, 200);
  assert.equal((await Order.findByPk(orderId)).status, 'approved');
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'valid' } }), 5);
});

test('la fecha de cierre se guarda, se puede borrar y se valida', async () => {
  const when = future();
  const ok = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ salesCloseAt: when });
  assert.equal(ok.status, 200);
  assert.equal(new Date(ok.body.salesCloseAt).toISOString(), when);
  const bad = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ salesCloseAt: 'mañana' });
  assert.equal(bad.status, 400);
  const clear = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ salesCloseAt: null });
  assert.equal(clear.body.salesCloseAt, null);
});

test('no se puede cargar el ganador con la venta abierta; sí al llegar la fecha de cierre', async () => {
  const { orderId } = await purchase();
  const order = await Order.findByPk(orderId);
  await webhook(pay(order));
  const first = (await Order.findByPk(orderId)).firstNumber;

  await setRaffle({ salesCloseAt: future() });
  const open = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: first });
  assert.equal(open.status, 409);
  assert.match(open.body.error, /Cerrá la venta/);

  await setRaffle({ salesCloseAt: past() }); // sigue "activo" pero ya pasó la fecha
  const closed = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: first });
  assert.equal(closed.status, 200);
});

test('consultar exige sesión de admin', async () => {
  const res = await request(app).post(`/api/admin/raffles/${raffleId}/readiness`);
  assert.equal(res.status, 401);
});

test('consultar con la venta abierta no da el visto bueno', async () => {
  const res = await readiness();
  assert.equal(res.status, 200);
  assert.equal(res.body.ready, false);
  assert.ok(res.body.blockers.some((b) => /venta sigue abierta/.test(b)));
});

test('consultar carga el pago aprobado cuyo aviso nunca llegó', async () => {
  const { orderId } = await purchase();
  pay(await Order.findByPk(orderId)); // MP lo tiene aprobado, pero no se llamó al webhook
  assert.equal((await Order.findByPk(orderId)).status, 'pending');
  await setRaffle({ salesCloseAt: past() });
  const res = await readiness();
  assert.equal(res.body.recovered, 1);
  const order = await Order.findByPk(orderId);
  assert.equal(order.status, 'approved');
  assert.equal(await Chance.count({ where: { OrderId: orderId, status: 'valid' } }), 5);
});

test('un pago en proceso impide el visto bueno; una compra sin pago, no', async () => {
  await Order.destroy({ where: { status: 'pending' } });
  const a = await purchase();
  const b = await purchase();
  pay(await Order.findByPk(a.orderId), 'in_process'); // ej. cupón de pago en efectivo
  await setRaffle({ salesCloseAt: past() });
  const blocked = await readiness();
  assert.equal(blocked.body.awaiting, 1);
  assert.equal(blocked.body.noPayment, 1);
  assert.equal(blocked.body.ready, false);
  assert.ok(blocked.body.blockers.some((x) => /en proceso/.test(x)));

  await Order.update({ status: 'rejected' }, { where: { id: a.orderId } }); // se resolvió
  await Order.update({ status: 'rejected' }, { where: { id: b.orderId } });
  const ok = await readiness();
  assert.equal(ok.body.ready, true);
});

test('si MP no responde, la consulta lo informa y no da el visto bueno', async () => {
  await Order.destroy({ where: { status: 'pending' } });
  await Order.update({ status: 'rejected' }, { where: { status: 'needs_review' } });
  await purchase();
  await setRaffle({ salesCloseAt: past() });
  const original = mp.searchPayments;
  mp.searchPayments = async () => { throw new Error('MP caído'); };
  try {
    const res = await readiness();
    assert.equal(res.body.errors, 1);
    assert.equal(res.body.ready, false);
  } finally {
    mp.searchPayments = original;
  }
});

test('el resumen cuenta las chances válidas pagas y gratuitas', async () => {
  const res = await readiness();
  const total = await Chance.count({ where: { RaffleId: raffleId, status: 'valid' } });
  assert.equal(res.body.validChances, total);
  assert.equal(res.body.paidChances + res.body.freeChances, total);
});
