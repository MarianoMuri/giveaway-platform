const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order, Chance, FreeEntry } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { createPurchase } = require('../src/services/purchases');
const numbers = require('../src/services/numbers');
const { voidNumbers } = numbers;

const payments = {};
mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];
function webhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app).post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', reqId).send({ type: 'payment', data: { id: paymentId } });
}

let auth, raffleId, otherRaffleId, courseId, packId;
let ana, luis, free, mpOrder; // datos sembrados

const search = (q, id = raffleId) => request(app).get(`/api/admin/raffles/${id}/search`).query({ q }).set(auth);
const manual = (name, dni, email, chances = 5) =>
  request(app).post('/api/admin/orders/manual').set(auth).send({ raffleId, chances, courseId, amount: 15000, buyer: { name, dni, email, phone: '2914000000' } });

async function freeEntry(rId, { name, dni, email, status = 'confirmed' }) {
  return sequelize.transaction(async (t) => {
    const { first } = await numbers.reserveBlock(rId, 1, t);
    const entry = await FreeEntry.create({ RaffleId: rId, name, dni, email, status, number: first, confirmedAt: new Date(), tokenHash: 'secreto', ipHash: 'iphash' }, { transaction: t });
    await Chance.create({ number: first, RaffleId: rId, FreeEntryId: entry.id }, { transaction: t });
    return entry;
  });
}

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const mk = async () => {
    const r = await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sorteo', prize: 'Onix' });
    await request(app).patch(`/api/admin/raffles/${r.body.id}`).set(auth).send({ status: 'active' });
    return r.body.id;
  };
  raffleId = await mk();
  otherRaffleId = await mk();
  const c = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina básica').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'cocina.pdf');
  courseId = c.body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 5).id;

  ana = (await manual('Ana Gómez', '30111222', 'ana@test.com')).body; // 100000-100004
  luis = (await manual('Luis Díaz', '28999888', 'luis.diaz@gmail.com')).body; // 100005-100009
  await manual('Ana Gómez', '30111222', 'ana@test.com', 2); // segunda compra de Ana: 100010-100011
  const { orderId } = await createPurchase({ raffleId, packId, courseId, buyer: { name: 'Carla Ruiz', email: 'carla@test.com', phone: '2915555555', dni: '33444555' } });
  const o = await Order.findByPk(orderId);
  payments['777001'] = { id: '777001', status: 'approved', statusDetail: 'accredited', externalReference: orderId, amount: Number(o.amount) };
  await webhook('777001');
  mpOrder = await Order.findByPk(orderId); // 100012-100016
  free = await freeEntry(raffleId, { name: 'Marta Ruiz', dni: '27111222', email: 'marta@test.com' }); // 100017
  await freeEntry(raffleId, { name: 'Pendiente Sinconfirmar', dni: '26111222', email: 'pend@test.com', status: 'unconfirmed' });
  await manual('Otra Persona', '30111222', 'otra@test.com', 1);
  await request(app).post('/api/admin/orders/manual').set(auth).send({ raffleId: otherRaffleId, chances: 1, courseId, amount: 1000, buyer: { name: 'Ana Gómez', dni: '30111222', email: 'ana@test.com' } });
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('el buscador exige sesión de admin y al menos 3 caracteres', async () => {
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/search`).query({ q: 'ana' })).status, 401);
  assert.equal((await search('an')).status, 400);
  assert.equal((await search('')).status, 400);
});

test('por número exacto: dice de quién es y trae la compra', async () => {
  const res = await search('100007');
  assert.equal(res.body.type, 'number');
  assert.equal(res.body.match.status, 'valid');
  assert.equal(res.body.match.source, 'purchase');
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].buyerName, 'Luis Díaz');
  assert.equal(res.body.results[0].id, luis.id);
});

test('por número de una participación gratuita', async () => {
  const res = await search(String(free.number));
  assert.equal(res.body.match.source, 'free');
  assert.deepEqual(res.body.results.map((r) => [r.kind, r.name]), [['free', 'Marta Ruiz']]);
});

test('un número anulado se encuentra y se ve su estado y motivo', async () => {
  await voidNumbers(luis.id, undefined, 'Pago reintegrado');
  const res = await search('100005');
  assert.equal(res.body.match.status, 'void');
  assert.equal(res.body.match.voidReason, 'Pago reintegrado');
  assert.equal(res.body.results[0].voidedNumbers, 5);
});

test('un número que no existe en este sorteo no devuelve nada', async () => {
  const res = await search('999999');
  assert.deepEqual([res.body.match, res.body.results], [null, []]);
});

test('por DNI: todas las compras y la participación gratuita de esa persona', async () => {
  const res = await search('30.111.222'); // con puntos
  assert.equal(res.body.type, 'dni');
  const names = res.body.results.map((r) => r.buyerName).sort();
  assert.deepEqual(names, ['Ana Gómez', 'Ana Gómez', 'Otra Persona']);
  const ranges = res.body.results.filter((r) => r.buyerName === 'Ana Gómez').map((r) => [r.firstNumber, r.lastNumber]).sort();
  assert.deepEqual(ranges, [[100000, 100004], [100010, 100011]]);
  const gratis = await search('27111222');
  assert.deepEqual(gratis.body.results.map((r) => r.kind), ['free']);
});

test('por email, completo o parcial y sin importar mayúsculas', async () => {
  assert.equal((await search('LUIS.DIAZ@gmail.com')).body.results.length, 1);
  assert.equal((await search('@test.com')).body.type, 'text');
  const part = await search('diaz');
  assert.equal(part.body.results[0].buyerName, 'Luis Díaz');
});

test('por nombre parcial también trae las participaciones gratuitas', async () => {
  const res = await search('ruiz');
  assert.deepEqual(res.body.results.map((r) => r.kind + ':' + (r.buyerName || r.name)).sort(), ['free:Marta Ruiz', 'order:Carla Ruiz']);
});

test('% y _ se buscan literalmente, no como comodines', async () => {
  assert.deepEqual((await search('%%%')).body.results, []);
  assert.deepEqual((await search('___')).body.results, []);
});

test('la ficha de la compra trae el número de operación de Mercado Pago', async () => {
  const res = await search('33444555');
  const card = res.body.results[0];
  assert.equal(card.mpPaymentId, '777001');
  assert.equal(card.status, 'approved');
  assert.equal(card.chances, 5);
  assert.equal(card.id, mpOrder.id);
});

test('busca solo dentro del sorteo y no muestra compras rechazadas ni participaciones sin confirmar', async () => {
  const other = await search('30111222', otherRaffleId);
  assert.equal(other.body.results.length, 1);
  assert.equal((await search('pend@test.com')).body.results.length, 0);
  await Order.update({ status: 'rejected' }, { where: { buyerName: 'Otra Persona' } });
  assert.equal((await search('Otra Persona')).body.results.length, 0);
});

test('la respuesta no expone hashes ni datos internos de las participaciones gratuitas', async () => {
  const res = await search('27111222');
  const text = JSON.stringify(res.body);
  assert.ok(!/tokenHash|ipHash|deviceHash|secreto|iphash/.test(text));
});

test('el CSV incluye las participaciones gratuitas y las compras anuladas', async () => {
  await Order.update({ status: 'refunded', voidedAt: new Date(), voidReason: 'Pago reintegrado' }, { where: { id: luis.id } });
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.match(res.text, /"Marta Ruiz";"27111222";"";"marta@test.com";"Participación gratuita";"1";"100017";"100017";"0.00";"gratuita"/);
  assert.doesNotMatch(res.text, /Sinconfirmar/);
  assert.match(res.text, /"Luis Díaz".*"refunded";"";"[^"]+";"Pago reintegrado"/);
  assert.match(res.text, /Pago reintegrado/);
});

test('el CSV neutraliza celdas que Excel abriría como fórmula', async () => {
  await manual('=HYPERLINK("http://x")', '31222333', '+cmd@test.com', 1);
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.match(res.text, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(res.text, /"'\+cmd@test.com"/);
});
