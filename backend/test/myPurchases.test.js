const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mypurchases-test-'));
process.env.PUBLIC_API_URL = 'http://api.test';
process.env.FRONTEND_URL = 'http://web.test';
process.env.BRAND_NAME = 'ZONA NORTE';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Order } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const myPurchases = require('../src/services/myPurchases');
const { createPurchase } = require('../src/services/purchases');
const { confirmPackOrder } = require('../src/services/purchases');
const { accessLink } = require('../src/services/emailTemplates');

mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/${order.id}` });

let sent = [];
mailer.send = async (msg) => { sent.push(msg); return { id: `msg-${sent.length}` }; };

const PDF = Buffer.from('%PDF-1.4\ncurso\n%%EOF');
const mkBuyer = (email) => ({ name: 'Ana Gómez', email, phone: '2914555555', dni: '30111222', province: 'B' });
let raffleId, courseId, packId;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  raffleId = (await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Gran Sorteo', prize: 'Onix 0km', drawDate: '2026-12-08T00:00:00.000Z' })).body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  courseId = (await request(app).post('/api/admin/courses').set(auth).field('title', 'Cocina básica').attach('pdf', PDF, 'cocina.pdf')).body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 20).id;
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));
test.beforeEach(() => { sent = []; myPurchases.resetThrottle(); });

// Compra paga: crea la orden y la aprueba como lo haría el webhook
async function paidOrder(email) {
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: mkBuyer(email) });
  const order = await Order.findByPk(orderId);
  await sequelize.transaction((t) => confirmPackOrder(order, { amount: Number(order.amount), paymentId: `p-${orderId}`, status: 'approved' }, t));
  return Order.findByPk(orderId);
}
const waitFor = async (fn, ms = 1000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timeout');
};
const tokenFromMail = (mail) => mail.text.match(/token=([\w.-]+)/)[1];

test('con compras pagas se envía el link y con él se listan las compras', async () => {
  const o1 = await paidOrder('ana@test.com');
  const o2 = await paidOrder('ANA@test.com'); // distinto uso de mayúsculas: misma persona
  await paidOrder('otra@test.com');

  const res = await request(app).post('/api/my-purchases/link').send({ email: ' Ana@Test.com ' });
  assert.equal(res.status, 202);
  await waitFor(() => sent.length === 1);
  assert.equal(sent[0].to, 'ana@test.com');
  assert.match(sent[0].html, /Ver mis compras/);
  assert.match(sent[0].text, /2 compras/);

  const list = await request(app).get('/api/my-purchases').set('Authorization', `Bearer ${tokenFromMail(sent[0])}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((o) => o.id).sort(), [o1.id, o2.id].sort());
  const first = list.body.find((o) => o.id === o1.id);
  assert.equal(first.courseTitle, 'Cocina básica');
  assert.equal(first.firstNumber, o1.firstNumber);
  assert.equal(first.raffle.prize, 'Onix 0km');
  assert.equal(first.hasCourse, true);
  assert.equal(first.buyerEmail, undefined); // no se exponen datos de contacto
});

test('la respuesta es idéntica exista o no el email y no se manda nada sin compras', async () => {
  await paidOrder('ana@test.com');
  const real = await request(app).post('/api/my-purchases/link').send({ email: 'ana@test.com' });
  const fake = await request(app).post('/api/my-purchases/link').send({ email: 'nadie@test.com' });
  assert.equal(real.status, fake.status);
  assert.deepEqual(real.body, fake.body);
  await waitFor(() => sent.length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@test.com');
});

test('las compras pendientes o rechazadas no cuentan', async () => {
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: mkBuyer('pendiente@test.com') });
  assert.equal(orderId.length > 0, true);
  const out = await myPurchases.requestLink('pendiente@test.com');
  assert.deepEqual(out, { sent: false, reason: 'no-orders' });
  assert.equal(sent.length, 0);
});

test('email con formato inválido: 400', async () => {
  const res = await request(app).post('/api/my-purchases/link').send({ email: 'no-es-un-mail' });
  assert.equal(res.status, 400);
  assert.equal((await request(app).post('/api/my-purchases/link').send({})).status, 400);
});

test('un segundo pedido del mismo email en el minuto no manda otro mail', async () => {
  await paidOrder('ana@test.com');
  assert.deepEqual(await myPurchases.requestLink('ana@test.com'), { sent: true });
  assert.deepEqual(await myPurchases.requestLink('ana@test.com'), { sent: false, reason: 'throttled' });
  assert.equal(sent.length, 1);
});

test('el token sirve solo para "Mis compras": vencido, adulterado o de otro propósito dan 401', async () => {
  await paidOrder('ana@test.com');
  const get = (t) => request(app).get('/api/my-purchases').set('Authorization', `Bearer ${t}`);
  assert.equal((await request(app).get('/api/my-purchases')).status, 401);
  assert.equal((await get('basura')).status, 401);
  const expired = jwt.sign({ purpose: 'my-purchases', email: 'ana@test.com' }, config.jwtSecret, { expiresIn: -10 });
  assert.equal((await get(expired)).status, 401);
  const otherPurpose = jwt.sign({ purpose: 'course-download', email: 'ana@test.com' }, config.jwtSecret, { expiresIn: '5m' });
  assert.equal((await get(otherPurpose)).status, 401);
  const forged = jwt.sign({ purpose: 'my-purchases', email: 'ana@test.com' }, 'otra-clave', { expiresIn: '5m' });
  assert.equal((await get(forged)).status, 401);
  // el token de un comprador no deja ver las compras de otro
  await paidOrder('unica@test.com');
  const mine = await get(myPurchases.createToken('unica@test.com'));
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].raffle.title, 'Gran Sorteo');
});

test('desde la lista se puede volver a descargar el curso', async () => {
  const order = await paidOrder('ana@test.com');
  const list = await request(app).get('/api/my-purchases').set('Authorization', `Bearer ${myPurchases.createToken('ana@test.com')}`);
  const dl = await request(app).post(`/api/orders/${list.body[0].id}/download-link`);
  assert.equal(dl.status, 200);
  const file = await request(app).get(dl.body.url.replace('http://api.test', '')).buffer(true);
  assert.deepEqual(Buffer.from(file.body), PDF);
  assert.equal(order.id, list.body[0].id);
});

test('el email del link escapa los datos y no incluye nada de las compras', () => {
  const { html, text, subject } = accessLink({ brand: { name: '<b>X</b>', color: 'rojo', logoUrl: '' }, url: 'http://web.test/mis-compras?token=a"b', minutes: 30, count: 1 });
  assert.equal(subject, 'Tu link para ver tus compras');
  assert.ok(!html.includes('<b>X</b>'));
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(html.includes('token=a&quot;b'));
  assert.match(text, /1 compra con este email/);
});
