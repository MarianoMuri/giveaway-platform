const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_WEBHOOK_SECRET = 'secreto-test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'promos-test-'));

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order, Chance } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const promos = require('../src/services/promos');

// ---- Mercado Pago simulado ----
const payments = {};
let paymentSeq = 0;
mp.createCheckout = async ({ order }) => ({ id: `pref-${order.id}`, initPoint: `https://mp.test/checkout/${order.id}` });
mp.getPayment = async (id) => payments[id];
const pay = (order) => {
  const id = String(++paymentSeq);
  payments[id] = { id, status: 'approved', statusDetail: 'accredited', externalReference: order.id, amount: Number(order.amount) };
  return id;
};
function signedWebhook(paymentId) {
  const ts = String(Date.now());
  const reqId = `req-${paymentId}`;
  const v1 = crypto.createHmac('sha256', 'secreto-test').update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
  return request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', reqId)
    .send({ type: 'payment', data: { id: paymentId } });
}

// ---- Lógica pura (sin base) ----

const q20 = { packId: 3, chances: 20, packPrice: 45000, double: false, doubleExtra: 0, total: 45000, perChance: 2250 };
const P = (o) => ({ id: 1, name: 'Promo', percent: 20, bonus: 0, minChances: 0, code: null, enabled: true, startsAt: null, endsAt: null, maxUses: null, used: 0, ...o });
const NOW = new Date('2026-11-20T15:00:00Z');

test('descuento en %: baja el total y deja las chances', () => {
  const r = promos.apply(q20, P({ percent: 20 }));
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances, r.perChance], [20, 36000, 9000, 0, 1800]);
});

test('chances de regalo: suma chances y no cambia el precio', () => {
  const r = promos.apply(q20, P({ percent: 0, bonus: 5 }));
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances, r.perChance], [25, 45000, 0, 5, 1800]);
});

test('descuento y chances de regalo juntos: baja el total y suma las chances', () => {
  const r = promos.apply(q20, P({ percent: 20, bonus: 5 }));
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances, r.perChance], [25, 36000, 9000, 5, 1440]);
  assert.deepEqual([r.promo.percent, r.promo.bonus], [20, 5]);
});

test('una promo combinada le conviene más que una de solo descuento parecida', () => {
  const list = [P({ id: 1, percent: 20 }), P({ id: 2, percent: 20, bonus: 5 })];
  assert.equal(promos.select({ promos: list, q: q20, now: NOW }).id, 2);
});

test('el descuento se calcula en centavos enteros', () => {
  const r = promos.apply({ ...q20, total: 0.1, packPrice: 0.1, chances: 1 }, P({ percent: 15 }));
  assert.equal(r.discount, 0.02); // 15% de 0,10 = 0,015 -> 2 centavos
  assert.equal(r.total, 0.08);
});

test('estado: apagada, programada, vencida, agotada y activa', () => {
  assert.equal(promos.stateOf(P({ enabled: false }), NOW), 'off');
  assert.equal(promos.stateOf(P({ startsAt: new Date('2026-11-21T00:00:00Z') }), NOW), 'scheduled');
  assert.equal(promos.stateOf(P({ endsAt: new Date('2026-11-19T00:00:00Z') }), NOW), 'expired');
  assert.equal(promos.stateOf(P({ maxUses: 10, used: 10 }), NOW), 'soldout');
  assert.equal(promos.stateOf(P({ endsAt: new Date('2026-11-30T00:00:00Z'), startsAt: new Date('2026-11-01T00:00:00Z') }), NOW), 'on');
});

test('sin código: se aplica la automática que más le conviene al comprador; las apagadas no cuentan', () => {
  const list = [
    P({ id: 1, percent: 10 }),
    P({ id: 2, percent: 30 }),
    P({ id: 3, percent: 50, enabled: false }),
    P({ id: 4, percent: 80, code: 'SECRETO' }), // con código: nunca se aplica sola
  ];
  assert.equal(promos.select({ promos: list, q: q20, now: NOW }).id, 2);
  assert.equal(promos.select({ promos: [P({ enabled: false })], q: q20, now: NOW }), null);
});

test('el mínimo de chances decide si aplica', () => {
  const list = [P({ id: 1, minChances: 50 })];
  assert.equal(promos.select({ promos: list, q: q20, now: NOW }), null);
  assert.equal(promos.select({ promos: list, q: { ...q20, chances: 50, total: 90000 }, now: NOW }).id, 1);
});

test('con código: sin importar mayúsculas ni espacios; reemplaza a la automática', () => {
  const list = [P({ id: 1, percent: 10 }), P({ id: 2, percent: 20, code: 'ZONA10' })];
  assert.equal(promos.select({ promos: list, q: q20, code: ' zona 10 ', now: NOW }).id, 2);
});

test('un código malo avisa, no se ignora en silencio', () => {
  const list = [P({ id: 2, code: 'ZONA10' }), P({ id: 3, code: 'VIEJO', endsAt: new Date('2026-01-01T00:00:00Z') }), P({ id: 4, code: 'POCOS', maxUses: 1, used: 1 }), P({ id: 5, code: 'GRANDE', minChances: 100 })];
  assert.throws(() => promos.select({ promos: list, q: q20, code: 'NOEXISTE', now: NOW }), /no es válido o ya venció/);
  assert.throws(() => promos.select({ promos: list, q: q20, code: 'VIEJO', now: NOW }), /no es válido o ya venció/);
  assert.throws(() => promos.select({ promos: list, q: q20, code: 'POCOS', now: NOW }), /ya no tiene usos/);
  assert.throws(() => promos.select({ promos: list, q: q20, code: 'GRANDE', now: NOW }), /100 chances o más/);
});

test('validación de lo que manda el panel', () => {
  const ok = { name: 'Black Friday', percent: 20, code: 'bf 20', enabled: true };
  assert.deepEqual(
    { ...promos.validate(ok), startsAt: null, endsAt: null },
    { name: 'Black Friday', percent: 20, bonus: 0, minChances: 0, code: 'BF20', enabled: true, startsAt: null, endsAt: null, maxUses: null }
  );
  const bad = [
    [{ ...ok, name: '' }, /nombre/],
    [{ ...ok, percent: 0 }, /al menos una cosa/],
    [{ ...ok, percent: 100 }, /1 a 90/],
    [{ ...ok, percent: 2.5 }, /entero/],
    [{ ...ok, percent: 0, bonus: 5000 }, /1 a 1000/],
    [{ ...ok, code: 'a' }, /código/],
    [{ ...ok, startsAt: '2026-12-01', endsAt: '2026-11-01' }, /posterior/],
    [{ ...ok, maxUses: 0 }, /tope de usos/],
  ];
  for (const [input, re] of bad) assert.throws(() => promos.validate(input), re, JSON.stringify(input));
});

// ---- Flujo completo: panel, cotización, compra y pago ----

let auth, raffleId, courseId, packs;
const buyer = { name: 'Ana Gómez', email: 'ana@test.com', phone: '2915551111', dni: '30111222', province: 'B' };
const api = (p) => `/api/raffles/${raffleId}${p}`;
const admin = (p) => `/api/admin/raffles/${raffleId}${p}`;
const pack = (n) => packs.find((p) => p.chances === n);
const quote = (body) => request(app).post(api('/quote')).send(body);
const create = (body) => request(app).post(admin('/promos')).set(auth).send({ name: 'Promo', percent: 10, ...body });

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
  raffleId = (await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sorteo Onix', prize: 'Onix 0km' })).body.id;
  await request(app).patch(admin(''))
    .set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  courseId = (await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Cocina básica').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'cocina.pdf')).body.id;
  packs = (await request(app).get(api('/packs'))).body.packs;
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('el panel exige ser administrador', async () => {
  assert.equal((await request(app).get(admin('/promos'))).status, 401);
  assert.equal((await request(app).post(admin('/promos')).send({ name: 'x' })).status, 401);
});

test('promo con código: no aparece en la página pública y la cotización la aplica', async () => {
  const made = await create({ name: 'Código ZONA20', percent: 20, code: 'zona20', enabled: true });
  assert.equal(made.status, 201);
  assert.equal(made.body.code, 'ZONA20');

  const pub = (await request(app).get(api('/packs'))).body;
  assert.deepEqual(pub.promos, []); // las promos con código no se listan
  assert.equal(pub.packs.find((p) => p.chances === 20).final, null);

  const base = await quote({ packId: pack(20).id });
  assert.equal(base.body.total, 45000);
  assert.equal(base.body.promo, undefined);

  const withCode = await quote({ packId: pack(20).id, code: 'Zona20' });
  assert.equal(withCode.status, 200);
  assert.deepEqual([withCode.body.total, withCode.body.discount, withCode.body.chances], [36000, 9000, 20]);
  assert.equal(withCode.body.promo.name, 'Código ZONA20');

  const bad = await quote({ packId: pack(20).id, code: 'NOEXISTE' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no es válido/);
});

test('apagar la promo con el interruptor la deja sin efecto, y volver a prenderla la reactiva', async () => {
  const list = (await request(app).get(admin('/promos')).set(auth)).body;
  const p = list.find((x) => x.code === 'ZONA20');
  const off = await request(app).put(admin(`/promos/${p.id}`)).set(auth).send({ enabled: false });
  assert.equal(off.body.enabled, false);
  assert.equal((await quote({ packId: pack(20).id, code: 'ZONA20' })).status, 400);
  await request(app).put(admin(`/promos/${p.id}`)).set(auth).send({ enabled: true });
  assert.equal((await quote({ packId: pack(20).id, code: 'ZONA20' })).status, 200);
});

test('promo automática de chances de regalo: se muestra en la página y se aplica sola', async () => {
  const made = await create({ name: 'Comprá 20 y llevate 5 más', percent: 0, bonus: 5, minChances: 20, enabled: true });
  assert.equal(made.status, 201);

  const pub = (await request(app).get(api('/packs'))).body;
  assert.deepEqual(pub.promos.map((p) => p.name), ['Comprá 20 y llevate 5 más']);
  assert.equal(pub.packs.find((p) => p.chances === 5).final, null); // no llega al mínimo
  const f = pub.packs.find((p) => p.chances === 20).final;
  assert.deepEqual([f.chances, f.total, f.bonusChances], [25, 45000, 5]);

  const q = await quote({ packId: pack(20).id }); // sin código: la automática
  assert.deepEqual([q.body.chances, q.body.total, q.body.promo.bonus, q.body.promo.percent], [25, 45000, 5, 0]);
  const withCode = await quote({ packId: pack(20).id, code: 'ZONA20' }); // el código reemplaza a la automática
  assert.deepEqual([withCode.body.chances, withCode.body.total], [20, 36000]);
});

test('no se pueden repetir códigos en un sorteo, y las fechas fuera de rango la apagan sola', async () => {
  const dup = await create({ code: 'ZONA20' });
  assert.equal(dup.status, 409);
  const past = await create({ name: 'Vencida', code: 'VENCIDA', enabled: true, startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z' });
  assert.equal(past.status, 201);
  assert.equal((await quote({ packId: pack(20).id, code: 'VENCIDA' })).status, 400);
  const future = await create({ name: 'Futura', code: 'FUTURA', enabled: true, startsAt: '2999-01-01T00:00:00Z' });
  assert.equal((await quote({ packId: pack(20).id, code: 'FUTURA' })).status, 400);
  await request(app).delete(admin(`/promos/${past.body.id}`)).set(auth);
  await request(app).delete(admin(`/promos/${future.body.id}`)).set(auth);
});

test('la compra con código cobra el total con descuento y guarda la promo usada', async () => {
  const res = await request(app).post(api('/purchases')).send({ courseId, packId: pack(20).id, code: 'ZONA20', buyer });
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.total, res.body.chances], [36000, 20]);
  const order = await Order.findByPk(res.body.orderId);
  assert.deepEqual([Number(order.amount), Number(order.discount), order.promoCode, order.promoName, order.bonusChances], [36000, 9000, 'ZONA20', 'Código ZONA20', 0]);
});

test('un código inválido frena la compra antes de crear nada', async () => {
  const before = await Order.count();
  const res = await request(app).post(api('/purchases')).send({ courseId, packId: pack(20).id, code: 'NOEXISTE', buyer });
  assert.equal(res.status, 400);
  assert.equal(await Order.count(), before);
});

test('al pagar una compra con chances de regalo se asignan todas, incluidas las de regalo', async () => {
  // sin código: aplica la automática "Comprá 20 y llevate 5 más"
  const res = await request(app).post(api('/purchases')).send({ courseId, packId: pack(20).id, buyer });
  assert.deepEqual([res.body.total, res.body.chances], [45000, 25]);
  const order = await Order.findByPk(res.body.orderId);
  assert.equal(order.bonusChances, 5);

  assert.equal((await signedWebhook(pay(order))).status, 200);
  await order.reload();
  assert.equal(order.status, 'approved');
  assert.equal(order.lastNumber - order.firstNumber + 1, 25);
  assert.equal(await Chance.count({ where: { OrderId: order.id } }), 25);
});

test('tope de usos: cuenta solo las compras acreditadas', async () => {
  const made = await create({ name: 'Solo 1', code: 'SOLOUNO', percent: 10, maxUses: 1, enabled: true });
  const first = await request(app).post(api('/purchases')).send({ courseId, packId: pack(20).id, code: 'SOLOUNO', buyer });
  assert.equal(first.status, 201);
  // pendiente, todavía sin pagar: el código sigue disponible
  assert.equal((await quote({ packId: pack(20).id, code: 'SOLOUNO' })).status, 200);
  await signedWebhook(pay(await Order.findByPk(first.body.orderId)));
  const after = await quote({ packId: pack(20).id, code: 'SOLOUNO' });
  assert.equal(after.status, 400);
  assert.match(after.body.error, /ya no tiene usos/);
  const listed = (await request(app).get(admin('/promos')).set(auth)).body.find((p) => p.id === made.body.id);
  assert.equal(listed.used, 1);
});

test('una sola promo puede dar descuento, chances de regalo y código a la vez', async () => {
  const made = await create({ name: 'Relámpago triple', percent: 20, bonus: 5, code: 'RAYO', enabled: true });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.percent, made.body.bonus, made.body.code], [20, 5, 'RAYO']);
  const q = await quote({ packId: pack(20).id, code: 'rayo' });
  assert.deepEqual([q.body.chances, q.body.total, q.body.discount, q.body.bonusChances], [25, 36000, 9000, 5]);
  const bad = await create({ name: 'Vacía', percent: 0, bonus: 0 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /al menos una cosa/);
  // apagarla y prenderla desde el interruptor
  await request(app).put(admin(`/promos/${made.body.id}`)).set(auth).send({ enabled: false });
  assert.equal((await quote({ packId: pack(20).id, code: 'RAYO' })).status, 400);
  await request(app).delete(admin(`/promos/${made.body.id}`)).set(auth);
});

test('borrar una promo no cambia las compras ya hechas', async () => {
  const list = (await request(app).get(admin('/promos')).set(auth)).body;
  const p = list.find((x) => x.code === 'ZONA20');
  assert.equal((await request(app).delete(admin(`/promos/${p.id}`)).set(auth)).status, 204);
  const order = await Order.findOne({ where: { promoCode: 'ZONA20' } });
  assert.equal(order.promoName, 'Código ZONA20');
  assert.equal(Number(order.discount), 9000);
  assert.equal((await request(app).delete(admin(`/promos/${p.id}`)).set(auth)).status, 404);
});
