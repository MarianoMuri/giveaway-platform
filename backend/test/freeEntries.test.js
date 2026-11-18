const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'free-test-'));
process.env.FRONTEND_URL = 'http://web.test';
process.env.BRAND_NAME = 'ZONA NORTE';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
process.env.FREE_ENTRY_REQUESTS_PER_15_MIN = '10000';
const app = require('../src/app');
const config = require('../src/config');

const { sequelize, Order, FreeEntry, Chance } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const { captcha } = require('../src/services/captcha');
const freeEntries = require('../src/services/freeEntries');
const { createPurchase, confirmPackOrder } = require('../src/services/purchases');
const { drawWinner, raffleStats } = require('../src/services/orders');
const { HttpError } = require('../src/services/errors');
const { freeEntryConfirm, freeEntryNumber } = require('../src/services/emailTemplates');

mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/${order.id}` });
let sent = [];
mailer.send = async (msg) => { sent.push(msg); return { id: `m-${sent.length}` }; };

const PDF = Buffer.from('%PDF-1.4\ncurso\n%%EOF');
let auth, raffleId, courseId, packId, seq = 0;
const isPg = () => sequelize.getDialect() === 'postgres';
const device = () => `dispositivo-${String(++seq).padStart(6, '0')}-abcdefgh`;
const dniN = () => String(30000000 + ++seq);
const waitFor = async (fn, ms = 1000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timeout');
};

const body = (extra = {}) => ({ name: 'Lucía Pérez', dni: dniN(), email: 'lucia@test.com', deviceId: device(), ...extra });
const ask = (data, id = raffleId) => request(app).post(`/api/raffles/${id}/free-entries`).send(data);
const tokenOf = (mail) => mail.text.match(/token=([\w]+)/)[1];
const confirmToken = (token) => request(app).post('/api/free-entries/confirm').send({ token });
// Pide y confirma en un paso; devuelve la respuesta de la confirmación
async function join(extra = {}) {
  const before = sent.length;
  const r = await ask(body(extra));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return confirmToken(tokenOf(sent[before]));
}

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  raffleId = (await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Gran Sorteo', prize: 'Onix 0km', drawDate: '2026-12-08T00:00:00.000Z', youtubeUrl: 'https://youtube.com/live/x' })).body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active' });
  courseId = (await request(app).post('/api/admin/courses').set(auth).field('title', 'Cocina').attach('pdf', PDF, 'c.pdf')).body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 5).id;
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));
test.beforeEach(() => { sent = []; config.freeEntries.perIpPerDay = 1000; });

test('el número se asigna recién al confirmar el email', async () => {
  const data = body();
  const r = await ask(data);
  assert.equal(r.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'lucia@test.com');
  assert.match(sent[0].html, /Confirmar y recibir mi número/);
  const pending = await FreeEntry.findOne({ where: { dni: data.dni } });
  assert.equal(pending.status, 'unconfirmed');
  assert.equal(pending.number, null);
  assert.equal(await Chance.count({ where: { FreeEntryId: pending.id } }), 0);

  const ok = await confirmToken(tokenOf(sent[0]));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.already, false);
  assert.equal(ok.body.raffle.prize, 'Onix 0km');
  const confirmed = await FreeEntry.findByPk(pending.id);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.number, ok.body.number);
  await waitFor(() => sent.length === 2); // aviso con el número
  assert.equal(sent[1].subject, `Tu número para el sorteo: ${ok.body.number}`);
});

test('el link es idempotente: abrirlo dos veces devuelve el mismo número', async () => {
  await ask(body());
  const token = tokenOf(sent[0]);
  const a = await confirmToken(token);
  const b = await confirmToken(token);
  assert.equal(b.status, 200);
  assert.equal(b.body.already, true);
  assert.equal(b.body.number, a.body.number);
});

test('1 número por DNI y por sorteo, aunque el DNI se escriba con puntos', async () => {
  const dni = dniN();
  const first = await join({ dni, email: 'a@test.com' });
  assert.equal(first.status, 200);
  const again = await ask(body({ dni: `${dni.slice(0, 2)}.${dni.slice(2, 5)}.${dni.slice(5)}`, email: 'otro@test.com' }));
  assert.equal(again.status, 409);
  assert.match(again.body.error, /ya está participando/);
});

test('un pedido nuevo con el mismo DNI pisa al anterior sin confirmar', async () => {
  const dni = dniN();
  const deviceId = device();
  await ask(body({ dni, deviceId }));
  const oldToken = tokenOf(sent[0]);
  await ask(body({ dni, deviceId, email: 'nuevo@test.com' }));
  assert.equal(sent[1].to, 'nuevo@test.com');
  assert.equal((await confirmToken(oldToken)).status, 404); // el link viejo ya no sirve
  assert.equal((await confirmToken(tokenOf(sent[1]))).status, 200);
  assert.equal(await FreeEntry.count({ where: { dni } }), 1);
});

test('un link vencido no asigna número', async () => {
  const data = body();
  await ask(data);
  await FreeEntry.update({ tokenExpiresAt: new Date(Date.now() - 1000) }, { where: { dni: data.dni } });
  const r = await confirmToken(tokenOf(sent[0]));
  assert.equal(r.status, 410);
  assert.equal((await FreeEntry.findOne({ where: { dni: data.dni } })).number, null);
});

test('límite por dispositivo: un segundo DNI desde el mismo dispositivo se rechaza', async () => {
  const deviceId = device();
  assert.equal((await ask(body({ deviceId }))).status, 202);
  const r = await ask(body({ deviceId }));
  assert.equal(r.status, 429);
  assert.match(r.body.error, /dispositivo/);
});

test('límite por IP configurable', async () => {
  config.freeEntries.perIpPerDay = 2;
  await FreeEntry.destroy({ where: {} });
  assert.equal((await ask(body())).status, 202);
  assert.equal((await ask(body())).status, 202);
  const r = await ask(body());
  assert.equal(r.status, 429);
  assert.match(r.body.error, /conexión/);
});

test('captcha: si falla no se registra nada', async () => {
  const original = captcha.verify;
  captcha.verify = async () => { throw new HttpError(400, 'La verificación de seguridad falló'); };
  try {
    const data = body();
    const r = await ask(data);
    assert.equal(r.status, 400);
    assert.equal(await FreeEntry.count({ where: { dni: data.dni } }), 0);
    assert.equal(sent.length, 0);
  } finally { captcha.verify = original; }
});

test('validación de datos y dispositivo', async () => {
  assert.equal((await ask(body({ name: 'A' }))).status, 400);
  assert.equal((await ask(body({ dni: '123' }))).status, 400);
  assert.equal((await ask(body({ email: 'no-mail' }))).status, 400);
  assert.equal((await ask(body({ deviceId: 'corto' }))).status, 400);
  assert.equal((await ask(body({ deviceId: undefined }))).status, 400);
  assert.equal(sent.length, 0);
});

test('sorteo en borrador, cerrado o sin modalidad gratuita no admite participaciones', async () => {
  const mk = async (extra = {}) => (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'X', prize: 'Y' })).body.id;
  const draft = await mk();
  assert.equal((await ask(body(), draft)).status, 404);
  await request(app).patch(`/api/admin/raffles/${draft}`).set(auth).send({ status: 'active', freeEntryEnabled: false });
  assert.equal((await ask(body(), draft)).status, 409);
  await request(app).patch(`/api/admin/raffles/${draft}`).set(auth).send({ freeEntryEnabled: true, status: 'closed' });
  assert.equal((await ask(body(), draft)).status, 409);
});

test('no se guarda el IP ni el dispositivo en claro', async () => {
  const data = body();
  await ask(data);
  const e = await FreeEntry.findOne({ where: { dni: data.dni } });
  assert.ok(!e.ipHash.includes('127.0.0.1'));
  assert.ok(!e.deviceHash.includes(data.deviceId));
  assert.match(e.deviceHash, /^[0-9a-f]{64}$/);
  assert.ok(e.tokenHash && !sent[0].text.includes(e.tokenHash)); // en la base solo queda el hash del link
});

test('comparte contador con las compras: nunca repite un número', async () => {
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: { name: 'Ana Gómez', email: 'ana@test.com', phone: '2914555555', dni: '30111222' } });
  const order = await Order.findByPk(orderId);
  await sequelize.transaction((t) => confirmPackOrder(order, { amount: Number(order.amount), id: 'p1', status: 'approved' }, t));
  await order.reload();
  const free = await join();
  assert.ok(free.body.number > order.lastNumber);
  const all = await Chance.findAll({ where: { RaffleId: raffleId }, attributes: ['number'] });
  assert.equal(new Set(all.map((c) => c.number)).size, all.length);
});

test('las gratuitas no cuentan como chances vendidas ni como recaudación', async () => {
  const before = await raffleStats(raffleId);
  await join();
  const after = await raffleStats(raffleId);
  assert.equal(after.chancesSold, before.chancesSold);
  assert.equal(after.revenue, before.revenue);
  assert.equal(after.freeEntries, before.freeEntries + 1);
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(pub.body.chancesSold, before.chancesSold);
  assert.equal(pub.body.freeEntryEnabled, true);
});

test('el listado del panel exige sesión y no expone el hash del link', async () => {
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/free-entries`)).status, 401);
  const r = await request(app).get(`/api/admin/raffles/${raffleId}/free-entries`).set(auth);
  assert.equal(r.status, 200);
  assert.ok(r.body.length > 0);
  assert.equal(r.body[0].tokenHash, undefined);
  assert.equal(r.body[0].ipHash, undefined);
});

test('el mismo link confirmado a la vez asigna un solo número', { skip: !isPg() && 'requiere PostgreSQL (SQLite no admite transacciones concurrentes)' }, async () => {
  const before = await Chance.count({ where: { RaffleId: raffleId } });
  await ask(body());
  const token = tokenOf(sent[sent.length - 1]);
  const results = await Promise.all([1, 2, 3, 4].map(() => confirmToken(token)));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.body.number)).size, 1);
  assert.equal(await Chance.count({ where: { RaffleId: raffleId } }), before + 1);
});

test('confirmaciones simultáneas de personas distintas reciben números distintos y consecutivos', { skip: !isPg() && 'requiere PostgreSQL (SQLite no admite transacciones concurrentes)' }, async () => {
  const tokens = [];
  for (let i = 0; i < 10; i++) { await ask(body()); tokens.push(tokenOf(sent[sent.length - 1])); }
  const rs = await Promise.all(tokens.map(confirmToken));
  const nums = rs.map((r) => r.body.number).sort((a, b) => a - b);
  assert.equal(new Set(nums).size, 10);
  assert.equal(nums[9] - nums[0], 9);
});

test('los emails escapan los datos', () => {
  const brand = { name: '<b>X</b>', color: 'rojo', logoUrl: '' };
  const raffle = { prize: '<i>Auto</i>', title: 'T', drawDate: null, youtubeUrl: null };
  const c = freeEntryConfirm({ brand, url: 'http://web.test/x?token=a"b', hours: 24, raffle });
  assert.ok(!c.html.includes('<i>Auto</i>') && c.html.includes('&lt;i&gt;Auto&lt;/i&gt;'));
  assert.ok(c.html.includes('token=a&quot;b'));
  const n = freeEntryNumber({ brand, entry: { name: '<script>x</script> Pérez', number: 100007 }, raffle });
  assert.ok(!n.html.includes('<script>'));
  assert.match(n.subject, /100007/);
});

// Va al final: al cargar el ganador el sorteo pasa a "sorteado" y ya no admite participaciones
test('si sale una participación gratuita, el panel muestra al ganador (y una anulada no puede ganar)', async () => {
  const data = body({ name: 'Marta Ruiz', email: 'marta@test.com' });
  const ok = await join(data);
  const win = await drawWinner(raffleId, ok.body.number);
  assert.equal(win.winner.source, 'free');
  assert.equal(win.winner.name, 'Marta Ruiz');
  assert.equal(win.winner.email, 'marta@test.com');
  assert.equal(win.winner.dni, data.dni);

  const entry = await FreeEntry.findOne({ where: { dni: data.dni } });
  const v = await request(app).post(`/api/admin/free-entries/${entry.id}/void`).set(auth);
  assert.equal(v.status, 200);
  await assert.rejects(() => drawWinner(raffleId, ok.body.number), /anulado/);
  assert.equal((await Chance.findOne({ where: { number: ok.body.number, RaffleId: raffleId } })).status, 'void');
  assert.equal((await confirmToken('x'.repeat(64))).status, 404);
});
