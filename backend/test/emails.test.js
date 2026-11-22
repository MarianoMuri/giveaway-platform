const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'emails-test-'));
process.env.PUBLIC_API_URL = 'http://api.test';
process.env.FRONTEND_URL = 'http://web.test';
process.env.BRAND_NAME = 'ZONA NORTE';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const emails = require('../src/services/emails');
const { handlePayment } = require('../src/services/orders');
const { createPurchase } = require('../src/services/purchases');
const { purchaseConfirmation } = require('../src/services/emailTemplates');

// ---- Mercado Pago y email simulados ----
const payments = {};
let paymentSeq = 0;
mp.createCheckout = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/${order.id}` });
mp.getPayment = async (id) => payments[id];
const pay = (order, status = 'approved') => {
  const id = String(++paymentSeq);
  payments[id] = { id, status, statusDetail: status, externalReference: order.id, amount: Number(order.amount) };
  return id;
};

let sent = [];
let smtpDown = false;
mailer.send = async (msg) => {
  if (smtpDown) throw new Error('SMTP no disponible');
  sent.push(msg);
  return { id: `msg-${sent.length}` };
};

function signedWebhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app).post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', reqId).send({});
}

// El envío inmediato no se espera en el webhook: los tests esperan a que termine
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout esperando la condición');
}

const PDF = Buffer.from('%PDF-1.4\ncurso\n%%EOF');
const buyer = { name: 'Ana Gómez', email: 'ana@test.com', phone: '2914555555', dni: '30111222', province: 'B' };
let auth, raffleId, courseId, packId;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Gran Sorteo', prize: 'Onix 0km', drawDate: '2026-12-08T00:00:00.000Z', youtubeUrl: 'https://youtube.com/live/x', permitNumber: 'LOT-9' });
  raffleId = r.body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', terms: 'x'.repeat(120) });
  courseId = (await request(app).post('/api/admin/courses').set(auth).field('title', 'Cocina básica').attach('pdf', PDF, 'cocina.pdf')).body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 20).id;
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));
test.beforeEach(() => { sent = []; smtpDown = false; });

const newOrder = async (extra = {}) => Order.findByPk((await createPurchase({ raffleId, packId, courseId, buyer, ...extra })).orderId);

test('al aprobarse el pago se envía el email con números, curso, monto y código', async () => {
  const order = await newOrder({ double: true });
  assert.equal(order.emailStatus, 'none'); // todavía no pagó
  await signedWebhook(pay(order));
  await waitFor(async () => (await order.reload()).emailStatus === 'sent');

  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.equal(mail.to, 'ana@test.com');
  assert.equal(mail.subject, 'Tus números para el sorteo: 100000 al 100039');
  for (const s of ['100000 al 100039', '40 chances', 'Cocina básica', '$ 65.000', order.id.slice(0, 8).toUpperCase(), 'ZONA NORTE', 'http://web.test/compra/']) {
    assert.ok(mail.html.includes(s), `falta en el HTML: ${s}`);
  }
  assert.match(mail.text, /Tus números: 100000 al 100039/);
  assert.equal(order.emailAttempts, 1);
  assert.ok(order.emailSentAt);
});

test('el link de descarga del email está firmado y baja el PDF', async () => {
  const order = await newOrder();
  await signedWebhook(pay(order));
  await waitFor(() => sent.length === 1);
  const url = sent[0].html.match(/href="(http:\/\/api\.test\/api\/courses\/download\?token=[^"]+)"/)[1];
  const res = await request(app).get(url.replace('http://api.test', '')).buffer(true);
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(res.body), PDF);
});

test('un aviso repetido de Mercado Pago no manda el email dos veces', async () => {
  const order = await newOrder();
  const id = pay(order);
  await signedWebhook(id);
  await waitFor(async () => (await order.reload()).emailStatus === 'sent');
  await signedWebhook(id);
  await signedWebhook(id);
  await emails.processPending();
  assert.equal(sent.length, 1);
});

test('un pago rechazado no manda email', async () => {
  const order = await newOrder();
  await signedWebhook(pay(order, 'rejected'));
  await emails.processPending();
  assert.equal(sent.length, 0);
  assert.equal((await order.reload()).emailStatus, 'none');
});

test('si el SMTP falla, la compra se aprueba igual y el email se reintenta', async () => {
  smtpDown = true;
  const order = await newOrder();
  const result = await handlePayment(pay(order));
  assert.equal(await result.email, 'retry');
  await order.reload();
  assert.equal(order.status, 'approved'); // el pago no depende del email
  assert.equal(order.emailStatus, 'pending');
  assert.equal(order.emailAttempts, 1);
  assert.match(order.emailLastError, /SMTP no disponible/);
  assert.ok(order.emailNextAttemptAt > new Date(Date.now() + 50 * 1000)); // espera ~1 minuto

  smtpDown = false;
  await emails.processPending();
  assert.equal(sent.length, 0, 'todavía no le toca');

  await order.update({ emailNextAttemptAt: new Date(Date.now() - 1000) }); // pasó el minuto
  await emails.processPending();
  assert.equal(sent.length, 1);
  await order.reload();
  assert.deepEqual([order.emailStatus, order.emailAttempts, order.emailLastError], ['sent', 2, null]);
});

test('después del último reintento queda como fallido', async () => {
  smtpDown = true;
  const order = await newOrder();
  await (await handlePayment(pay(order))).email;
  for (let i = 1; i < emails.MAX_ATTEMPTS; i++) {
    await order.update({ emailNextAttemptAt: new Date(Date.now() - 1000) });
    await emails.processPending();
  }
  await order.reload();
  assert.equal(order.emailStatus, 'failed');
  assert.equal(order.emailAttempts, emails.MAX_ATTEMPTS);
  assert.equal(order.emailNextAttemptAt, null);
});

test('dos procesos enviando el mismo email a la vez mandan uno solo', async () => {
  smtpDown = true;
  const order = await newOrder();
  await (await handlePayment(pay(order))).email; // queda pendiente
  smtpDown = false;
  await order.update({ emailNextAttemptAt: new Date(Date.now() - 1000) });
  const results = await Promise.all([emails.deliver(order.id), emails.deliver(order.id), emails.processPending()]);
  assert.equal(sent.length, 1);
  assert.equal(results.flat().filter((r) => r === 'sent').length, 1);
});

test('venta manual: exige los mismos datos que la compra online y manda el email', async () => {
  const base = { raffleId, chances: 5, courseId, amount: 15000 };
  const full = { name: 'Eva Ríos', dni: '27888777', email: 'eva@test.com', phone: '2914000000', province: 'B' };
  const post = (buyer) => request(app).post('/api/admin/orders/manual').set(auth).send({ ...base, buyer });
  for (const falta of ['email', 'phone', 'province']) {
    const { [falta]: _omit, ...incompleto } = full;
    assert.equal((await post(incompleto)).status, 400, `sin ${falta} debe fallar`);
  }
  assert.equal((await post({ ...full, email: 'no-es-mail' })).status, 400);

  const conMail = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ ...base, buyer: full });
  await waitFor(() => sent.length === 1);
  assert.equal(sent[0].to, 'eva@test.com');
  assert.match(sent[0].subject, new RegExp(`${conMail.body.firstNumber} al ${conMail.body.lastNumber}`));
});

test('reenvío desde el panel, incluso a un email corregido', async () => {
  const order = await newOrder();
  await signedWebhook(pay(order));
  await waitFor(() => sent.length === 1);

  const bad = await request(app).post(`/api/admin/orders/${order.id}/resend-email`).set(auth).send({ email: 'no-es-email' });
  assert.equal(bad.status, 400);

  const res = await request(app).post(`/api/admin/orders/${order.id}/resend-email`).set(auth).send({ email: 'Ana.Nueva@Test.com' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.result, res.body.emailStatus, res.body.buyerEmail], ['sent', 'sent', 'ana.nueva@test.com']);
  assert.equal(sent[1].to, 'ana.nueva@test.com');

  const pending = await newOrder();
  assert.equal((await request(app).post(`/api/admin/orders/${pending.id}/resend-email`).set(auth).send({})).status, 409);
});

test('la compra pagada puede pedir un link de descarga nuevo', async () => {
  const pending = await newOrder();
  assert.equal((await request(app).post(`/api/orders/${pending.id}/download-link`)).status, 409);
  await handlePayment(pay(pending));
  const res = await request(app).post(`/api/orders/${pending.id}/download-link`);
  assert.equal(res.status, 200);
  const dl = await request(app).get(res.body.url.replace('http://api.test', ''));
  assert.equal(dl.status, 200);
});

test('la plantilla escapa los datos del comprador', () => {
  const mail = purchaseConfirmation({
    order: { id: 'abc', buyerName: '<script>alert(1)</script> Pérez', firstNumber: 1, lastNumber: 1, chances: 1, amount: 1, courseTitle: '"><img src=x>' },
    raffle: { title: 'T', prize: 'P' },
    brand: { name: 'B', color: 'red;background:url(x)' },
    downloadUrl: null, orderUrl: 'http://x', linkHours: 72,
  });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(!mail.html.includes('<img src=x>'));
  assert.ok(!mail.html.includes('url(x)')); // un color inválido no se inyecta en el CSS
});
