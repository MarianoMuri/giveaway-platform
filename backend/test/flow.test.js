process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { expireOrders } = require('../src/services/orders');

// Mercado Pago simulado
const payments = {};
mp.createPreference = async ({ order }) => ({ id: 'pref-' + order.id, initPoint: 'https://mp.test/checkout/' + order.id });
mp.getPayment = async (id) => payments[id];

function signedWebhook(paymentId) {
  const ts = String(Date.now());
  const reqId = 'req-' + paymentId;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`)
    .set('x-request-id', reqId)
    .send({ type: 'payment', data: { id: paymentId } });
}

const buyer = { name: 'Juan Pérez', email: 'juan@test.com', phone: '2915555555', dni: '30111222' };
let token, raffleId;

test.before(async () => {
  await sequelize.sync({ force: true });
});

test('login admin y crear sorteo', async () => {
  const bad = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'mal' });
  assert.equal(bad.status, 401);
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  token = login.body.token;
  const r = await request(app).post('/api/admin/raffles').set('Authorization', `Bearer ${token}`).send({
    title: 'Gran Sorteo', prize: 'Auto 0km', pricePerNumber: 5000, totalNumbers: 100, status: 'active', permitNumber: 'LOT-123',
  });
  assert.equal(r.status, 201);
  raffleId = r.body.id;
  const grid = await request(app).get(`/api/raffles/${raffleId}/numbers`);
  assert.equal(grid.body.grid.length, 100);
});

test('compra aprobada: reserva, webhook firmado, números vendidos', async () => {
  const o = await request(app).post('/api/orders').send({ raffleId, numbers: [7, 8], buyer });
  assert.equal(o.status, 201);
  assert.match(o.body.checkoutUrl, /mp\.test/);

  // Otro comprador no puede tomar el 8 mientras está reservado
  const clash = await request(app).post('/api/orders').send({ raffleId, numbers: [8, 9], buyer });
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.body.unavailable, [8]);

  payments['111'] = { id: '111', status: 'approved', statusDetail: 'accredited', externalReference: o.body.orderId, amount: 10000 };
  const unsigned = await request(app).post('/api/webhooks/mercadopago?data.id=111&type=payment').send({});
  assert.equal(unsigned.status, 401);
  assert.equal((await signedWebhook('111')).status, 200);
  assert.equal((await signedWebhook('111')).status, 200); // repetido: idempotente

  const order = await request(app).get(`/api/orders/${o.body.orderId}`);
  assert.equal(order.body.status, 'approved');
  const grid = (await request(app).get(`/api/raffles/${raffleId}/numbers`)).body.grid;
  assert.equal(grid[6], 2);
  assert.equal(grid[7], 2);
});

test('monto adulterado queda para revisión', async () => {
  const o = await request(app).post('/api/orders').send({ raffleId, numbers: [20], buyer });
  payments['222'] = { id: '222', status: 'approved', externalReference: o.body.orderId, amount: 1 };
  await signedWebhook('222');
  assert.equal((await Order.findByPk(o.body.orderId)).status, 'needs_review');
});

test('reserva vencida libera números; pago tardío con número revendido va a revisión', async () => {
  const o = await request(app).post('/api/orders').send({ raffleId, numbers: [30], buyer });
  await Order.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: o.body.orderId } });
  const { Ticket } = require('../src/db');
  await Ticket.update({ reservedUntil: new Date(Date.now() - 1000) }, { where: { OrderId: o.body.orderId } });
  assert.equal(await expireOrders(), 1);
  assert.equal((await request(app).get(`/api/raffles/${raffleId}/numbers`)).body.grid[29], 0);

  // Otro compra el 30 y paga
  const o2 = await request(app).post('/api/orders').send({ raffleId, numbers: [30], buyer: { ...buyer, dni: '1' } });
  payments['333'] = { id: '333', status: 'approved', externalReference: o2.body.orderId, amount: 5000 };
  await signedWebhook('333');
  // Llega tarde el pago del primero
  payments['334'] = { id: '334', status: 'approved', externalReference: o.body.orderId, amount: 5000 };
  await signedWebhook('334');
  assert.equal((await Order.findByPk(o2.body.orderId)).status, 'approved');
  // La orden del primero estaba 'expired'; el pago aprobado la manda a revisión para reintegro
  assert.equal((await Order.findByPk(o.body.orderId)).status, 'needs_review');
});

test('compra con promo: cobra el precio de la promo y MP recibe el total', async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth).send({
    title: 'Promo', prize: 'Auto', pricePerNumber: 10000, totalNumbers: 50, status: 'active',
    promos: [{ qty: 2, price: 15000 }, { qty: 5, price: 30000 }],
  });
  assert.equal(r.status, 201);
  const pub = await request(app).get(`/api/raffles/${r.body.id}`);
  assert.equal(pub.body.promos.length, 2);
  let sentAmount;
  const orig = mp.createPreference;
  mp.createPreference = async ({ order }) => { sentAmount = Number(order.amount); return orig({ order }); };
  const o = await request(app).post('/api/orders').send({ raffleId: r.body.id, numbers: [1, 2, 3], buyer });
  mp.createPreference = orig;
  assert.equal(o.status, 201);
  assert.equal(sentAmount, 25000);
  payments['555'] = { id: '555', status: 'approved', externalReference: o.body.orderId, amount: 25000 };
  await signedWebhook('555');
  assert.equal((await Order.findByPk(o.body.orderId)).status, 'approved');
  const bad = await request(app).patch(`/api/admin/raffles/${r.body.id}`).set(auth).send({ promos: [{ qty: 2, price: 1 }, { qty: 2, price: 2 }] });
  assert.equal(bad.status, 400);
});

test('venta manual, ganador y exportación', async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const m = await request(app).post('/api/admin/orders/manual').set(auth).send({ raffleId, numbers: [50], buyer: { name: 'Ana' } });
  assert.equal(m.status, 201);
  const w = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: 7 });
  assert.equal(w.body.winner.name, 'Juan Pérez');
  const stats = await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth);
  assert.equal(stats.body.revenue, 20000);
  const csv = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.match(csv.text, /Juan Pérez/);
  assert.equal((await request(app).get('/api/admin/orders')).status, 401);
});
