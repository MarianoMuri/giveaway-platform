const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-test-'));
process.env.FRONTEND_URL = 'http://web.test';
process.env.FREE_ENTRY_REQUESTS_PER_15_MIN = '10000';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Raffle, Order, FreeEntry } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const { PROVINCES, DEFAULT_EXCLUDED } = require('../src/services/provinces');

mp.createPreference = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/${order.id}` });
mailer.send = async () => ({ id: 'm' });

const PDF = Buffer.from('%PDF-1.4\ncurso\n%%EOF');
const BASES = 'Bases y condiciones de prueba. '.repeat(5); // más de 100 caracteres
let auth, raffleId, courseId, packId, seq = 0;
const buyer = (extra = {}) => ({ name: 'Ana Gómez', email: 'ana@test.com', phone: '2914555555', dni: String(30000000 + ++seq), province: 'B', ...extra });
const buy = (b, id = raffleId) => request(app).post(`/api/raffles/${id}/purchases`).send({ packId, courseId, buyer: b });
const freeBody = (extra = {}) => ({ name: 'Lucía Pérez', dni: String(31000000 + ++seq), email: 'lucia@test.com', province: 'B', deviceId: `dispositivo-${String(++seq).padStart(6, '0')}-abcdefgh`, ...extra });
const ask = (data, id = raffleId) => request(app).post(`/api/raffles/${id}/free-entries`).send(data);

test.before(async () => {
  await sequelize.sync({ force: true });
  config.freeEntries.perIpPerDay = 1000;
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  raffleId = (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Gran Sorteo', prize: 'Onix 0km', permitNumber: 'LOT-1', terms: BASES })).body.id;
  assert.equal((await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active' })).status, 200);
  courseId = (await request(app).post('/api/admin/courses').set(auth).field('title', 'Cocina').attach('pdf', PDF, 'c.pdf')).body.id;
  packId = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body.packs.find((p) => p.chances === 5).id;
});
test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('el listado de provincias trae las 24 jurisdicciones, ordenadas', async () => {
  const res = await request(app).get('/api/provinces');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 24);
  assert.equal(new Set(res.body.map((p) => p.code)).size, 24);
  assert.ok(res.body.some((p) => p.name === 'Ciudad Autónoma de Buenos Aires'));
  const names = res.body.map((p) => p.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'es')));
  assert.equal(PROVINCES.length, 24);
});

test('un sorteo nuevo excluye por defecto las provincias con régimen propio, y la vista pública lo informa', async () => {
  const res = await request(app).get(`/api/raffles/${raffleId}`);
  assert.deepEqual([...res.body.excludedProvinces].sort(), [...DEFAULT_EXCLUDED].sort());
  const names = res.body.excludedProvinces.map((c) => PROVINCES.find((p) => p.code === c).name).sort();
  assert.deepEqual(names, ['Formosa', 'Jujuy', 'Mendoza', 'Neuquén', 'Río Negro', 'Salta', 'Tierra del Fuego']);
});

test('comprar: la provincia es obligatoria y tiene que ser válida', async () => {
  const sin = await buy(buyer({ province: undefined }));
  assert.equal(sin.status, 400);
  assert.match(sin.body.error, /provincia/i);
  const mala = await buy(buyer({ province: 'ZZ' }));
  assert.equal(mala.status, 400);
  assert.match(mala.body.error, /provincia/i);
});

test('comprar desde una provincia excluida: se rechaza y no queda ninguna compra', async () => {
  const before = await Order.count();
  for (const code of ['M', 'Q', 'V']) {
    const res = await buy(buyer({ province: code }));
    assert.equal(res.status, 409, code);
    assert.equal(res.body.code, 'province_excluded');
    assert.match(res.body.error, /no está disponible en/);
  }
  assert.equal(await Order.count(), before);
});

test('comprar desde una provincia habilitada: se guarda la provincia (en mayúscula)', async () => {
  const res = await buy(buyer({ province: 'b' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await Order.findByPk(res.body.orderId)).buyerProvince, 'B');
});

test('participación gratuita: provincia obligatoria y excluidas rechazadas sin dejar rastro', async () => {
  assert.equal((await ask(freeBody({ province: undefined }))).status, 400);
  assert.equal((await ask(freeBody({ province: 'ZZ' }))).status, 400);
  const before = await FreeEntry.count();
  const blocked = await ask(freeBody({ province: 'A' }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'province_excluded');
  assert.equal(await FreeEntry.count(), before);

  const data = freeBody({ province: 'x' });
  assert.equal((await ask(data)).status, 202);
  assert.equal((await FreeEntry.findOne({ where: { dni: data.dni } })).province, 'X');
});

test('el panel edita las provincias excluidas: valida, normaliza y quedan en la auditoría', async () => {
  const bad = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ excludedProvinces: ['M', 'ZZ'] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /ZZ/);

  const ok = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ excludedProvinces: ['m', 'M', 'q'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.excludedProvinces, ['M', 'Q']);

  // Mendoza sigue excluida; Salta (que ya no está en la lista) puede comprar
  assert.equal((await buy(buyer({ province: 'M' }))).status, 409);
  assert.equal((await buy(buyer({ province: 'A' }))).status, 201);

  const audit = await request(app).get('/api/admin/audit').set(auth);
  assert.ok(audit.body.some((e) => e.action === 'raffle.update' && /excludedProvinces/.test(e.detail)));

  // Lista vacía: ninguna provincia excluida
  const none = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ excludedProvinces: [] });
  assert.deepEqual(none.body.excludedProvinces, []);
  assert.equal((await buy(buyer({ province: 'M' }))).status, 201);
});

test('crear un sorteo permite indicar las provincias excluidas y las valida', async () => {
  assert.equal((await request(app).post('/api/admin/raffles').set(auth).send({ title: 'X', prize: 'Y', excludedProvinces: ['??'] })).status, 400);
  const r = await request(app).post('/api/admin/raffles').set(auth).send({ title: 'X', prize: 'Y', excludedProvinces: ['C'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.excludedProvinces, ['C']);
});

test('no se puede abrir la venta sin autorización ni bases (y el sorteo sigue en borrador)', async () => {
  const id = (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sin papeles', prize: 'Auto' })).body.id;
  const open = (extra) => request(app).patch(`/api/admin/raffles/${id}`).set(auth).send({ status: 'active', ...extra });

  const none = await open({});
  assert.equal(none.status, 409);
  assert.equal(none.body.code, 'legal_missing');
  assert.deepEqual(none.body.missing, ['el N° de autorización', 'las bases y condiciones']);
  assert.equal((await Raffle.findByPk(id)).status, 'draft');

  const short = await open({ permitNumber: 'LOT-5', terms: 'Bases cortas' });
  assert.equal(short.status, 409);
  assert.deepEqual(short.body.missing, ['las bases y condiciones']);
  assert.equal((await Raffle.findByPk(id)).permitNumber, null); // el pedido falló entero: no cargó nada

  const spaces = await open({ permitNumber: '   ', terms: BASES });
  assert.deepEqual(spaces.body.missing, ['el N° de autorización']);

  const ok = await open({ permitNumber: 'LOT-5', terms: BASES });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'active');
});

test('cargar los datos primero y abrir después también funciona; reabrir una venta cerrada exige lo mismo', async () => {
  const id = (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Paso a paso', prize: 'Auto' })).body.id;
  const patch = (b) => request(app).patch(`/api/admin/raffles/${id}`).set(auth).send(b);
  assert.equal((await patch({ permitNumber: 'LOT-7' })).status, 200); // guardar sin abrir no pide nada
  assert.equal((await patch({ status: 'active' })).status, 409);
  assert.equal((await patch({ terms: BASES })).status, 200);
  assert.equal((await patch({ status: 'active' })).status, 200);
  assert.equal((await patch({ status: 'closed' })).status, 200);
  await Raffle.update({ terms: '' }, { where: { id } });
  assert.equal((await patch({ status: 'active' })).status, 409);
});

test('la venta manual desde el panel no pide provincia', async () => {
  const res = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 2, courseId, amount: 5000, buyer: { name: 'Luis Díaz', dni: '28999888' } });
  assert.equal(res.status, 201);
});
