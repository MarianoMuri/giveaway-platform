const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mypurchases-dni-'));
process.env.PUBLIC_API_URL = 'http://api.test';
process.env.FRONTEND_URL = 'http://web.test';
process.env.BRAND_NAME = 'ZONA NORTE';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Order, FreeEntry } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const myPurchases = require('../src/services/myPurchases');
const { createPurchase } = require('../src/services/purchases');
const { confirmPackOrder } = require('../src/services/purchases');
const { captcha } = require('../src/services/captcha');

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
test.beforeEach(() => { sent = []; myPurchases.resetDniThrottle(); });

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


const dniOf = (o) => o.buyerDni;

test('con el DNI se ven los números sin mail y con el nombre abreviado', async () => {
  const o = await paidOrder('ana@test.com');
  const res = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30.111.222' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Ana G.');
  assert.equal(res.body.purchases.length, 1);
  const p = res.body.purchases[0];
  assert.equal(p.id, o.id);
  assert.equal(p.firstNumber, o.firstNumber);
  assert.equal(p.raffle.prize, 'Onix 0km');
  assert.equal(sent.length, 0); // no depende del mail
});

test('no expone datos de contacto ni el apellido completo', async () => {
  await paidOrder('ana@test.com');
  const res = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111222' });
  const txt = JSON.stringify(res.body);
  assert.doesNotMatch(txt, /ana@test\.com|2914555555|Gómez|buyerEmail|buyerDni/);
});

test('un DNI sin compras responde con la misma forma y sin datos', async () => {
  await paidOrder('ana@test.com');
  const real = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111222' });
  const fake = await request(app).post('/api/my-purchases/by-dni').send({ dni: '12345678' });
  assert.equal(fake.status, real.status);
  assert.deepEqual(Object.keys(fake.body).sort(), Object.keys(real.body).sort());
  assert.deepEqual(fake.body.purchases, []);
  assert.deepEqual(fake.body.freeEntries, []);
});

test('DNI inválido se rechaza', async () => {
  const res = await request(app).post('/api/my-purchases/by-dni').send({ dni: '123' });
  assert.equal(res.status, 400);
});

test('también muestra la participación gratuita confirmada (no la pendiente)', async () => {
  await FreeEntry.create({ RaffleId: raffleId, name: 'Luis Paz', dni: '20333444', email: 'l@test.com', status: 'confirmed', number: 100500 });
  await FreeEntry.create({ RaffleId: raffleId, name: 'Eva Gil', dni: '20555666', email: 'e@test.com', status: 'unconfirmed' });
  const ok = await request(app).post('/api/my-purchases/by-dni').send({ dni: '20333444' });
  assert.equal(ok.body.freeEntries.length, 1);
  assert.equal(ok.body.freeEntries[0].number, 100500);
  assert.equal(ok.body.name, 'Luis P.');
  const pend = await request(app).post('/api/my-purchases/by-dni').send({ dni: '20555666' });
  assert.deepEqual(pend.body.freeEntries, []);
});

test('las compras pendientes no se muestran', async () => {
  await createPurchase({ raffleId, packId, courseId, buyer: { ...mkBuyer('p@test.com'), dni: '40111222' } });
  const res = await request(app).post('/api/my-purchases/by-dni').send({ dni: '40111222' });
  assert.deepEqual(res.body.purchases, []);
});

test('límite de intentos por DNI', async () => {
  let last;
  for (let i = 0; i < 11; i += 1) last = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111222' });
  assert.equal(last.status, 429);
  const otro = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111223' });
  assert.equal(otro.status, 200); // otro DNI no se ve afectado
});

test('con captcha activo, sin token no hay respuesta', async () => {
  const orig = captcha.verify;
  captcha.verify = async (token) => { if (!token) { const e = new Error('Completá la verificación de seguridad'); e.status = 400; throw e; } return true; };
  try {
    const sin = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111222' });
    assert.equal(sin.status, 400);
    const con = await request(app).post('/api/my-purchases/by-dni').send({ dni: '30111222', captchaToken: 'ok' });
    assert.equal(con.status, 200);
  } finally { captcha.verify = orig; }
});

test('descargar exige DNI y el email de esa compra', async () => {
  const o = await paidOrder('ana@test.com');
  const body = { dni: dniOf(o), email: ' ANA@test.com ', orderId: o.id };
  const ok = await request(app).post('/api/my-purchases/download').send(body);
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /download/);

  const mal = await request(app).post('/api/my-purchases/download').send({ ...body, email: 'otro@test.com' });
  assert.equal(mal.status, 404);
  const otroDni = await request(app).post('/api/my-purchases/download').send({ ...body, dni: '99999999' });
  assert.equal(otroDni.status, 404);
  assert.equal(mal.body.error, otroDni.body.error); // no dice cuál dato falló
});

test('no se puede descargar una compra impaga', async () => {
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: { ...mkBuyer('pend@test.com'), dni: '41111222' } });
  const res = await request(app).post('/api/my-purchases/download').send({ dni: '41111222', email: 'pend@test.com', orderId });
  assert.equal(res.status, 404);
});
