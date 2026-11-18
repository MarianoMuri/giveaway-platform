process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/db');
const { quote, validateConfig, DEFAULT_PACKS } = require('../src/services/packs');

const offer = { enabled: true, pricePerChance: 1000 };
const pack20 = { id: 3, chances: 20, price: '45000.00', doubleEligible: true };

// ---- Cálculo del total (sin DB) ----

test('cotiza un pack sin "Duplicá"', () => {
  assert.deepEqual(quote({ pack: pack20, offer }), {
    packId: 3, chances: 20, packPrice: 45000, double: false, doubleExtra: 0, total: 45000,
  });
});

test('"Duplicá" duplica las chances y suma el precio por chance extra', () => {
  const q = quote({ pack: pack20, offer, double: true });
  assert.equal(q.chances, 40);
  assert.equal(q.doubleExtra, 20000);
  assert.equal(q.total, 65000);
});

test('"Duplicá" no se puede usar si está apagada o el pack no la admite', () => {
  assert.throws(() => quote({ pack: pack20, offer: { ...offer, enabled: false }, double: true }), /no está disponible/);
  assert.throws(() => quote({ pack: { ...pack20, doubleEligible: false }, offer, double: true }), /no está disponible/);
  // sin pedir "Duplicá" el pack se puede comprar igual
  assert.equal(quote({ pack: { ...pack20, doubleEligible: false }, offer }).total, 45000);
});

test('los montos con centavos no acumulan error de coma flotante', () => {
  const q = quote({ pack: { id: 1, chances: 3, price: '0.10', doubleEligible: true }, offer: { enabled: true, pricePerChance: 0.1 }, double: true });
  assert.equal(q.total, 0.4); // 0.1 + 3 * 0.1 en flotante da 0.4000000000000001
});

test('valida la configuración de packs', () => {
  const ok = { packs: [{ chances: 5, price: 15000 }], offer: { enabled: false } };
  assert.equal(validateConfig(ok).packs[0].doubleEligible, true);
  const bad = [
    [{ packs: [] }, /al menos un pack/],
    [{ packs: [{ chances: 0, price: 10 }] }, /entero entre/],
    [{ packs: [{ chances: 2.5, price: 10 }] }, /entero entre/],
    [{ packs: [{ chances: 5, price: 0 }] }, /mayor a 0/],
    [{ packs: [{ chances: 5, price: 10 }, { chances: 5, price: 20 }] }, /dos packs de 5/],
    [{ packs: [{ chances: 5, price: 10, featured: true }, { chances: 6, price: 20, featured: true }] }, /Solo un pack/],
    [{ packs: [{ chances: 5, price: 10 }], offer: { enabled: true, pricePerChance: 0 } }, /precio por chance extra/],
    [{ packs: [{ chances: 5, price: 10, doubleEligible: false }], offer: { enabled: true, pricePerChance: 1000 } }, /ningún pack/],
  ];
  for (const [input, msg] of bad) assert.throws(() => validateConfig(input), msg);
});

// ---- API ----

let auth;
let raffleId;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  const r = await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Sorteo', prize: 'Auto 0km', pricePerNumber: 3000, totalNumbers: 10 });
  raffleId = r.body.id;
});

test('un sorteo nuevo arranca con la escalera sugerida y "Duplicá" activa', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.packs.map((p) => p.chances), DEFAULT_PACKS.map((p) => p.chances));
  assert.equal(res.body.packs.filter((p) => p.featured).length, 1);
  assert.deepEqual(res.body.offer, { enabled: true, pricePerChance: 1000 });
  const featured = res.body.preview.find((p) => p.featured);
  assert.deepEqual([featured.chances, featured.price, featured.double.total], [20, 45000, 65000]);
});

test('la configuración de packs requiere login', async () => {
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/packs`)).status, 401);
  assert.equal((await request(app).put(`/api/admin/raffles/${raffleId}/packs`).send({ packs: [] })).status, 401);
});

test('editar packs conserva los ids, crea los nuevos y borra los que se sacan', async () => {
  const before = (await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth)).body.packs;
  const [p5, p10] = before;
  const res = await request(app).put(`/api/admin/raffles/${raffleId}/packs`).set(auth).send({
    packs: [
      { id: p5.id, chances: 5, price: 16000 },
      { id: p10.id, chances: 10, price: 26000, featured: true, doubleEligible: false },
      { chances: 15, price: 35000 },
    ],
    offer: { enabled: true, pricePerChance: 1200 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.packs.length, 3);
  assert.equal(res.body.packs[0].id, p5.id);
  assert.equal(Number(res.body.packs[0].price), 16000);
  assert.equal(res.body.packs[1].id, p10.id);
  assert.equal(res.body.packs[1].doubleEligible, false);
  assert.ok(!before.some((p) => p.id === res.body.packs[2].id));
  assert.deepEqual(res.body.offer, { enabled: true, pricePerChance: 1200 });
});

test('no se puede editar un pack de otro sorteo', async () => {
  const other = await request(app).post('/api/admin/raffles').set(auth)
    .send({ title: 'Otro', prize: 'Moto', pricePerNumber: 1000, totalNumbers: 5 });
  const foreign = (await request(app).get(`/api/admin/raffles/${other.body.id}/packs`).set(auth)).body.packs[0];
  const res = await request(app).put(`/api/admin/raffles/${raffleId}/packs`).set(auth)
    .send({ packs: [{ id: foreign.id, chances: 7, price: 1 }] });
  assert.equal(res.status, 400);
  // y la configuración del sorteo original queda intacta (la transacción se revierte)
  const after = await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth);
  assert.equal(after.body.packs.length, 3);
});

test('una configuración inválida devuelve 400 y no cambia nada', async () => {
  const res = await request(app).put(`/api/admin/raffles/${raffleId}/packs`).set(auth)
    .send({ packs: [{ chances: 5, price: 10 }, { chances: 5, price: 20 }] });
  assert.equal(res.status, 400);
  assert.equal((await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth)).body.packs.length, 3);
});

test('un sorteo en borrador no muestra sus packs ni cotiza', async () => {
  assert.equal((await request(app).get(`/api/raffles/${raffleId}/packs`)).status, 404);
  const packs = (await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth)).body.packs;
  assert.equal((await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: packs[0].id })).status, 409);
});

test('la vista pública trae cada pack con "Duplicá" ya calculada', async () => {
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active' });
  const res = await request(app).get(`/api/raffles/${raffleId}/packs`);
  assert.equal(res.status, 200);
  const [p5, p10, p15] = res.body.packs;
  assert.deepEqual([p5.chances, p5.price], [5, 16000]);
  assert.equal(p5.double.chances, 10);
  assert.equal(p5.double.total, 16000 + 5 * 1200);
  assert.equal(p10.double, null); // este pack no admite "Duplicá"
  assert.equal(p15.double.total, 35000 + 15 * 1200);
  assert.equal(p5.doubleEligible, undefined); // no expone campos internos
});

test('el backend cotiza el total de la compra', async () => {
  const { packs } = (await request(app).get(`/api/raffles/${raffleId}/packs`)).body;
  const plain = await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: packs[0].id });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.total, 16000);
  const doubled = await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: packs[0].id, double: true });
  assert.deepEqual([doubled.body.chances, doubled.body.total], [10, 22000]);
  // "double" tiene que ser exactamente true: un "true" en texto no la activa
  const str = await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: packs[0].id, double: 'true' });
  assert.equal(str.body.chances, 5);
  assert.equal((await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: packs[1].id, double: true })).status, 400);
  assert.equal((await request(app).post(`/api/raffles/${raffleId}/quote`).send({ packId: 99999 })).status, 400);
});

test('apagar "Duplicá" la saca de todos los packs', async () => {
  const current = (await request(app).get(`/api/admin/raffles/${raffleId}/packs`).set(auth)).body.packs;
  await request(app).put(`/api/admin/raffles/${raffleId}/packs`).set(auth).send({ packs: current, offer: { enabled: false } });
  const res = await request(app).get(`/api/raffles/${raffleId}/packs`);
  assert.equal(res.body.offer.enabled, false);
  assert.ok(res.body.packs.every((p) => p.double === null));
});
