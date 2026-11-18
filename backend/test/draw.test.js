const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Raffle, Order, Chance, FreeEntry, Draw, AuditLog } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { createPurchase } = require('../src/services/purchases');
const numbers = require('../src/services/numbers');

const payments = {};
let seq = 0;
mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];
function webhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app).post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', reqId).send({ type: 'payment', data: { id: paymentId } });
}

let auth, raffleId, courseId, packId;
const post = (url, body = {}) => request(app).post(url).set(auth).send(body);
const drawNow = (body) => post(`/api/admin/raffles/${raffleId}/draw`, body);
const manual = (name, dni, chances = 5) =>
  post('/api/admin/orders/manual', { raffleId, chances, courseId, amount: 15000, buyer: { name, dni, email: `${dni}@test.com`, phone: '2914000000' } });

// Cada test arranca con la lista vacía: se anulan las chances anteriores y el sorteo queda cerrado y sin ganador
async function fresh() {
  await Chance.update({ status: 'void' }, { where: { RaffleId: raffleId } });
  await Raffle.update({ status: 'closed', winnerNumber: null }, { where: { id: raffleId } });
  await Draw.destroy({ where: {} });
  await AuditLog.destroy({ where: {} });
}
async function freeEntry(name, dni) {
  return sequelize.transaction(async (t) => {
    const { first } = await numbers.reserveBlock(raffleId, 1, t);
    const entry = await FreeEntry.create({ RaffleId: raffleId, name, dni, email: `${dni}@test.com`, status: 'confirmed', number: first, confirmedAt: new Date() }, { transaction: t });
    await Chance.create({ number: first, RaffleId: raffleId, FreeEntryId: entry.id }, { transaction: t });
    return entry;
  });
}
async function withRandom(fn, impl) {
  const original = crypto.randomInt;
  crypto.randomInt = impl;
  try { return await fn(); } finally { crypto.randomInt = original; }
}

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sorteo', prize: 'Onix' });
  raffleId = r.body.id;
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active' });
  const c = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'c.pdf');
  courseId = c.body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 5).id;
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('sortear exige sesión de admin y la venta cerrada', async () => {
  assert.equal((await request(app).post(`/api/admin/raffles/${raffleId}/draw`)).status, 401);
  await Raffle.update({ status: 'active', salesCloseAt: null }, { where: { id: raffleId } });
  const open = await drawNow();
  assert.equal(open.status, 409);
  assert.match(open.body.error, /Cerrá la venta/);
});

test('sin números válidos no hay sorteo', async () => {
  await fresh();
  const res = await drawNow();
  assert.equal(res.status, 409);
  assert.match(res.body.error, /No hay números válidos/);
});

test('elige solo entre los números válidos: los anulados nunca salen', async () => {
  await fresh();
  const a = (await manual('Ana', '30111222')).body;
  const b = (await manual('Beto', '30111223')).body;
  await manual('Cata', '30111224');
  await numbers.voidNumbers(a.id, undefined, 'x');
  await numbers.voidNumbers(b.id, undefined, 'x');
  const res = await drawNow();
  assert.equal(res.status, 200);
  assert.equal(res.body.winner.name, 'Cata');
  assert.ok(res.body.number >= 100000);
  assert.equal(res.body.draw.validCount, 5);
});

test('entran las participaciones gratuitas confirmadas', async () => {
  await fresh();
  await freeEntry('Marta Ruiz', '27111222');
  const res = await drawNow();
  assert.equal(res.body.winner.source, 'free');
  assert.equal(res.body.winner.name, 'Marta Ruiz');
});

test('queda verificable: población, posición y quién lo hizo; el generador es crypto.randomInt', async () => {
  await fresh();
  await manual('Ana', '30111222'); // 5 chances
  await manual('Beto', '30111223'); // 5 chances
  const valid = (await Chance.findAll({ where: { RaffleId: raffleId, status: 'valid' }, order: [['number', 'ASC']] })).map((c) => c.number);
  let asked;
  const res = await withRandom(() => drawNow(), (max) => { asked = max; return 7; });
  assert.equal(asked, 10);
  assert.equal(res.body.number, valid[7]);
  const row = await Draw.findOne({ where: { RaffleId: raffleId } });
  assert.deepEqual([row.number, row.method, row.validCount, row.position, row.actor], [valid[7], 'random', 10, 7, 'admin@test']);
  assert.equal((await request(app).get(`/api/raffles/${raffleId}`)).body.winnerNumber, valid[7]);
});

test('repetir el sorteo exige un motivo y conserva el historial', async () => {
  await fresh();
  await manual('Ana', '30111222');
  const first = await drawNow();
  assert.equal(first.status, 200);
  const none = await drawNow();
  assert.equal(none.status, 409);
  assert.match(none.body.error, /motivo/);
  assert.equal((await drawNow({ reason: 'corto' })).status, 400);
  const again = await drawNow({ reason: 'El ganador no respondió en 48 horas' });
  assert.equal(again.status, 200);
  const list = (await request(app).get(`/api/admin/raffles/${raffleId}/draws`).set(auth)).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].reason, 'El ganador no respondió en 48 horas');
  assert.equal(list[0].supersededAt, null);
  assert.ok(list[1].supersededAt);
  const logs = (await request(app).get('/api/admin/audit').set(auth)).body.map((l) => l.action);
  assert.ok(logs.includes('draw.run') && logs.includes('draw.redo'));
});

test('la carga manual del ganador también exige motivo para repetir y queda registrada', async () => {
  await fresh();
  const a = (await manual('Ana', '30111222')).body;
  const n = a.firstNumber;
  const ok = await post(`/api/admin/raffles/${raffleId}/winner`, { number: n });
  assert.equal(ok.status, 200);
  assert.equal((await post(`/api/admin/raffles/${raffleId}/winner`, { number: n + 1 })).status, 409);
  const redo = await post(`/api/admin/raffles/${raffleId}/winner`, { number: n + 1, reason: 'Error al tipear el número en vivo' });
  assert.equal(redo.status, 200);
  const rows = await Draw.findAll({ where: { RaffleId: raffleId, method: 'manual' } });
  assert.equal(rows.length, 2);
});

test('si el número elegido resulta anulado al verificar el pago, se descarta y se vuelve a sortear', async () => {
  await fresh();
  const buyer = (name, dni) => ({ name, email: `${dni}@test.com`, phone: '2915555555', dni });
  const paid = async (name, dni) => {
    const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: buyer(name, dni) });
    const order = await Order.findByPk(orderId);
    const id = String(++seq);
    payments[id] = { id, status: 'approved', statusDetail: 'accredited', externalReference: orderId, amount: Number(order.amount) };
    await webhook(id);
    return { orderId, id };
  };
  await Raffle.update({ status: 'active' }, { where: { id: raffleId } });
  const first = await paid('Primero', '31000001');
  const second = await paid('Segundo', '31000002');
  await Raffle.update({ status: 'closed' }, { where: { id: raffleId } });
  payments[first.id].status = 'refunded'; // MP ya lo reintegró, el aviso no llegó
  const res = await withRandom(() => drawNow(), () => 0); // siempre la primera posición válida
  assert.equal(res.status, 200);
  assert.equal(res.body.winner.name, 'Segundo');
  assert.equal((await Order.findByPk(first.orderId)).status, 'refunded');
  const logs = await AuditLog.findAll({ where: { action: 'draw.discarded' } });
  assert.equal(logs.length, 1);
  assert.equal(second.orderId, res.body.winner.orderId);
});

test('dos sorteos a la vez: solo uno queda', async () => {
  await fresh();
  await manual('Ana', '30111222');
  await manual('Beto', '30111223');
  const [x, y] = await Promise.all([drawNow(), drawNow()]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal(await Draw.count({ where: { RaffleId: raffleId } }), 1);
});

test('el registro guarda quién hizo qué, sin datos personales ni contraseñas', async () => {
  await fresh();
  await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'incorrecta-123' });
  await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'closed', salesCloseAt: null });
  await manual('Ana Gómez', '30111222');
  const logs = (await request(app).get('/api/admin/audit').set(auth)).body;
  const actions = logs.map((l) => l.action);
  assert.ok(actions.includes('login.failed') && actions.includes('login.ok'));
  const patch = logs.find((l) => l.action === 'raffle.update');
  assert.equal(patch.actor, 'admin@test');
  assert.match(patch.detail, /status=closed/);
  assert.equal(patch.RaffleId, raffleId);
  const sale = logs.find((l) => l.action === 'order.manual');
  assert.match(sale.detail, /chances=5/);
  const all = JSON.stringify(logs);
  assert.ok(!/incorrecta-123|clave123|30111222|Ana Gómez|@test\.com/.test(all));
});

test('el registro es de solo lectura, exige sesión y se puede filtrar', async () => {
  assert.equal((await request(app).get('/api/admin/audit')).status, 401);
  for (const method of ['put', 'patch', 'delete', 'post']) {
    const res = await request(app)[method]('/api/admin/audit').set(auth).send({});
    assert.equal(res.status, 404);
  }
  await AuditLog.create({ actor: 'otro@test', action: 'raffle.update', RaffleId: 9999 });
  const only = (await request(app).get('/api/admin/audit?raffleId=9999').set(auth)).body;
  assert.deepEqual(only.map((l) => l.actor), ['otro@test']);
  assert.ok((await request(app).get('/api/admin/audit?limit=1').set(auth)).body.length <= 1);
});
