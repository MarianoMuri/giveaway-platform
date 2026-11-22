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
const P = (o) => ({ id: 1, name: 'Promo', percent: 20, bonus: 0, bonusEvery: 1, minChances: 0, code: null, enabled: true, startsAt: null, endsAt: null, maxUses: null, used: 0, ...o });
const G = (o) => P({ percent: 0, bonus: 1, bonusEvery: 10, name: 'Regalo', ...o }); // 1 de regalo por cada 10
const NOW = new Date('2026-11-20T15:00:00Z');
const qn = (chances) => ({ ...q20, chances, total: chances * 2250, packPrice: chances * 2250 });
const run = (list, q = q20, extra = {}) => promos.apply(q, promos.choose(promos.candidates({ promos: list, q, now: NOW, ...extra }), q.chances, extra.mode));

test('descuento en %: baja el total y deja las chances', () => {
  const r = promos.apply(q20, [P({ percent: 20 })]);
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances, r.perChance], [20, 36000, 9000, 0, 1800]);
});

test('chances de regalo "por cada X": no es lo mismo comprar 3 que 20 que 50', () => {
  const gift = G({ bonus: 1, bonusEvery: 10 });
  assert.equal(promos.giftFor(gift, 3), 0);
  assert.equal(promos.giftFor(gift, 9), 0);
  assert.equal(promos.giftFor(gift, 20), 2);
  assert.equal(promos.giftFor(gift, 50), 5);
  const r = promos.apply(q20, [gift]);
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances, r.perChance], [22, 45000, 0, 2, 2045.45]);
  assert.equal(promos.giftFor(G({ bonus: 3, bonusEvery: 5 }), 12), 6); // 3 por cada 5 -> 2 bloques completos
});

test('una promo de regalo no aplica si la compra no llega al primer bloque', () => {
  assert.equal(run([G()], qn(5)).applied, undefined);
  assert.equal(run([G()], qn(10)).bonusChances, 1);
});

test('un descuento y un regalo van juntos', () => {
  const r = run([P({ id: 1, percent: 20 }), G({ id: 2 })]);
  assert.deepEqual([r.chances, r.total, r.discount, r.bonusChances], [22, 36000, 9000, 2]);
  assert.equal(r.applied.length, 2);
  assert.equal(r.promo.name, 'Promo + Regalo');
});

test('dos descuentos a la vez: "best" aplica el mayor, "sum" los suma', () => {
  const list = [P({ id: 1, percent: 10 }), P({ id: 2, percent: 20 })];
  assert.deepEqual([run(list).discount, run(list).applied.map((p) => p.id)], [9000, [2]]);
  assert.deepEqual([run(list, q20, { mode: 'sum' }).discount, run(list, q20, { mode: 'sum' }).applied.length], [13500, 2]);
  const big = [P({ id: 1, percent: 60 }), P({ id: 2, percent: 50 })];
  assert.equal(run(big, q20, { mode: 'sum' }).discount, 40500); // tope: 90%
});

test('dos regalos a la vez: "best" aplica el mayor, "sum" los suma', () => {
  const list = [G({ id: 1, bonus: 1, bonusEvery: 10 }), G({ id: 2, bonus: 3, bonusEvery: 20 })]; // 2 y 3
  assert.equal(run(list).bonusChances, 3);
  assert.equal(run(list, q20, { mode: 'sum' }).bonusChances, 5);
});

test('el descuento se calcula en centavos enteros', () => {
  const r = promos.apply({ ...q20, total: 0.1, packPrice: 0.1, chances: 1 }, [P({ percent: 15 })]);
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

test('cada promo tiene sus propias fechas: una vence y la otra sigue', () => {
  const list = [P({ id: 1, percent: 10, endsAt: new Date('2026-11-19T00:00:00Z') }), G({ id: 2, startsAt: new Date('2026-11-01T00:00:00Z') })];
  const r = run(list);
  assert.deepEqual(r.applied.map((p) => p.id), [2]);
});

test('sin código: solo las automáticas vigentes; las apagadas y las de código no cuentan', () => {
  const list = [P({ id: 1, percent: 10 }), P({ id: 3, percent: 50, enabled: false }), P({ id: 4, percent: 80, code: 'SECRETO' })];
  assert.deepEqual(run(list).applied.map((p) => p.id), [1]);
  assert.equal(run([P({ enabled: false })]).applied, undefined);
});

test('el mínimo de chances decide si aplica', () => {
  const list = [P({ id: 1, minChances: 50 })];
  assert.equal(run(list).applied, undefined);
  assert.equal(run(list, qn(50)).applied.length, 1);
});

test('con código: sin importar mayúsculas ni espacios; se suma a las automáticas', () => {
  const list = [P({ id: 1, percent: 10 }), P({ id: 2, percent: 20, code: 'ZONA10' })];
  assert.deepEqual(run(list, q20, { code: ' zona 10 ' }).applied.map((p) => p.id), [2]); // best: gana el 20%
  const r = run(list, q20, { code: 'ZONA10', mode: 'sum' });
  assert.deepEqual([r.discount, r.promo.code], [13500, 'ZONA10']);
});

test('un código malo avisa, no se ignora en silencio', () => {
  const list = [P({ id: 2, code: 'ZONA10' }), P({ id: 3, code: 'VIEJO', endsAt: new Date('2026-01-01T00:00:00Z') }), P({ id: 4, code: 'POCOS', maxUses: 1, used: 1 }), P({ id: 5, code: 'GRANDE', minChances: 100 }), G({ id: 6, code: 'REGALO' })];
  const cand = (code, q = q20) => () => promos.candidates({ promos: list, q, code, now: NOW });
  assert.throws(cand('NOEXISTE'), /no es válido o ya venció/);
  assert.throws(cand('VIEJO'), /no es válido o ya venció/);
  assert.throws(cand('POCOS'), /ya no tiene usos/);
  assert.throws(cand('GRANDE'), /100 chances o más/);
  assert.throws(cand('REGALO', qn(5)), /10 chances o más/);
});

test('validación de lo que manda el panel', () => {
  const ok = { name: 'Black Friday', percent: 20, code: 'bf 20', enabled: true };
  assert.deepEqual(
    { ...promos.validate(ok), startsAt: null, endsAt: null },
    { name: 'Black Friday', percent: 20, bonus: 0, bonusEvery: 1, minChances: 0, code: 'BF20', enabled: true, startsAt: null, endsAt: null, maxUses: null }
  );
  assert.deepEqual(
    { bonus: promos.validate({ name: 'Regalo', bonus: 2, bonusEvery: 10 }).bonus, every: promos.validate({ name: 'Regalo', bonus: 2, bonusEvery: 10 }).bonusEvery },
    { bonus: 2, every: 10 }
  );
  const bad = [
    [{ ...ok, name: '' }, /nombre/],
    [{ ...ok, percent: 0 }, /una sola cosa/],
    [{ ...ok, bonus: 5 }, /una sola cosa/],
    [{ ...ok, percent: 100 }, /1 a 90/],
    [{ ...ok, percent: 2.5 }, /entero/],
    [{ name: 'Regalo', bonus: 5000 }, /1 a 1000/],
    [{ name: 'Regalo', bonus: 2, bonusEvery: 0.5 }, /por cada/],
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
  assert.deepEqual(withCode.body.applied.map((p) => p.code), ['ZONA20']);

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
  const made = await create({ name: 'Comprá 20 y llevate 5 más', percent: 0, bonus: 5, bonusEvery: 20, enabled: true });
  assert.equal(made.status, 201);

  const pub = (await request(app).get(api('/packs'))).body;
  assert.deepEqual(pub.promos.map((p) => p.name), ['Comprá 20 y llevate 5 más']);
  assert.equal(pub.packs.find((p) => p.chances === 5).final, null); // no llega al primer bloque de 20
  const f = pub.packs.find((p) => p.chances === 20).final;
  assert.deepEqual([f.chances, f.total, f.bonusChances], [25, 45000, 5]);

  const q = await quote({ packId: pack(20).id }); // sin código: la automática
  assert.deepEqual([q.body.chances, q.body.total, q.body.applied[0].bonus, q.body.applied[0].bonusEvery], [25, 45000, 5, 20]);
  const withCode = await quote({ packId: pack(20).id, code: 'ZONA20' }); // el código se suma al regalo automático
  assert.deepEqual([withCode.body.chances, withCode.body.total, withCode.body.discount], [25, 36000, 9000]);
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
  assert.deepEqual([res.body.total, res.body.chances], [36000, 25]); // el código (20% menos) + el regalo automático
  const order = await Order.findByPk(res.body.orderId);
  assert.deepEqual([Number(order.amount), Number(order.discount), order.promoCode, order.promoName, order.bonusChances], [36000, 9000, 'ZONA20', 'Código ZONA20 + Comprá 20 y llevate 5 más', 5]);
  assert.equal(order.PromoIds.split(',').length, 2);
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

let lastCheckout;
const stubCheckout = mp.createCheckout;
mp.createCheckout = async (args) => { lastCheckout = args; return stubCheckout(args); };

test('tope de usos firme: quien está pagando reserva su cupo, y si no paga en 5 minutos se libera', async () => {
  const made = await create({ name: 'Solo 1', code: 'SOLOUNO', percent: 10, maxUses: 1, enabled: true });
  const first = await request(app).post(api('/purchases')).send({ courseId, packId: pack(20).id, code: 'SOLOUNO', buyer });
  assert.equal(first.status, 201);
  assert.equal(lastCheckout.expiresInMinutes, 5); // el link de pago vence junto con la reserva
  // el cupo ya está reservado, aunque todavía no pagó
  const taken = await quote({ packId: pack(20).id, code: 'SOLOUNO' });
  assert.equal(taken.status, 400);
  assert.match(taken.body.error, /ya no tiene usos/);
  const listed = () => request(app).get(admin('/promos')).set(auth).then((r) => r.body.find((p) => p.id === made.body.id));
  assert.deepEqual([(await listed()).used, (await listed()).state], [1, 'soldout']);
  // pasan más de 5 minutos sin pagar: el cupo se libera
  const order = await Order.findByPk(first.body.orderId);
  await sequelize.query('UPDATE "Orders" SET "createdAt" = :d WHERE id = :id', { replacements: { d: new Date(Date.now() - 6 * 60 * 1000), id: order.id } });
  assert.equal((await quote({ packId: pack(20).id, code: 'SOLOUNO' })).status, 200);
  assert.equal((await listed()).used, 0);
  // si paga, el cupo queda tomado para siempre
  await signedWebhook(pay(order));
  const after = await quote({ packId: pack(20).id, code: 'SOLOUNO' });
  assert.equal(after.status, 400);
  assert.equal((await listed()).used, 1);
});

test('compras seguidas nunca superan el tope: la que llega sin cupo se rechaza', async () => {
  const made = await create({ name: 'Tres cupos', percent: 10, maxUses: 3, code: 'TRES', enabled: true });
  const ok = [];
  for (let i = 0; i < 3; i += 1) ok.push((await request(app).post(api('/purchases')).send({ courseId, packId: pack(5).id, code: 'TRES', buyer: { ...buyer, dni: String(31000000 + i) } })).status);
  assert.deepEqual(ok, [201, 201, 201]);
  const fourth = await request(app).post(api('/purchases')).send({ courseId, packId: pack(5).id, code: 'TRES', buyer: { ...buyer, dni: '31000009' } });
  assert.equal(fourth.status, 400); // ya se vio agotada al cotizar
  const used = (await request(app).get(admin('/promos')).set(auth)).body.find((p) => p.id === made.body.id).used;
  assert.equal(used, 3);
  // la página muestra cuántos quedan
  await request(app).put(admin(`/promos/${made.body.id}`)).set(auth).send({ code: '' }); // pasa a automática
  const pub = (await request(app).get(api('/packs'))).body.promos.find((p) => p.name === 'Tres cupos');
  assert.equal(pub, undefined); // sin cupos (agotada), ya no se muestra
});

test('cada promo da una sola cosa: descuento o regalo', async () => {
  const both = await create({ name: 'Las dos', percent: 20, bonus: 5 });
  assert.equal(both.status, 400);
  assert.match(both.body.error, /una sola cosa/);
  const none = await create({ name: 'Vacía', percent: 0, bonus: 0 });
  assert.equal(none.status, 400);
});

test('varios descuentos a la vez: aplicar la mayor o sumarlos, lo decide el administrador', async () => {
  const auto = await create({ name: 'Relámpago 10%', percent: 10, enabled: true });
  const code = await create({ name: 'Código RAYO', percent: 20, code: 'RAYO', enabled: true });
  // por defecto: aplica la mayor
  const best = await quote({ packId: pack(20).id, code: 'RAYO' });
  assert.deepEqual([best.body.discount, best.body.applied.map((p) => p.name)], [9000, ['Código RAYO', 'Comprá 20 y llevate 5 más']]);
  // sumarlos: 10% + 20% = 30% (el regalo automático sigue sumando sus chances)
  assert.equal((await request(app).patch(admin('')).set(auth).send({ promoMode: 'sum' })).body.promoMode, 'sum');
  const sum = await quote({ packId: pack(20).id, code: 'RAYO' });
  assert.deepEqual([sum.body.discount, sum.body.total, sum.body.chances], [13500, 31500, 25]);
  // la página pública muestra solo lo automático
  assert.equal((await request(app).get(api('/packs'))).body.packs.find((p) => p.chances === 20).final.discount, 4500);
  assert.equal((await request(app).patch(admin('')).set(auth).send({ promoMode: 'cualquiera' })).status, 400);
  await request(app).patch(admin('')).set(auth).send({ promoMode: 'best' });
  await request(app).delete(admin(`/promos/${auto.body.id}`)).set(auth);
  await request(app).delete(admin(`/promos/${code.body.id}`)).set(auth);
});

test('borrar una promo no cambia las compras ya hechas', async () => {
  const list = (await request(app).get(admin('/promos')).set(auth)).body;
  const p = list.find((x) => x.code === 'ZONA20');
  assert.equal((await request(app).delete(admin(`/promos/${p.id}`)).set(auth)).status, 204);
  const order = await Order.findOne({ where: { promoCode: 'ZONA20' } });
  assert.match(order.promoName, /^Código ZONA20/);
  assert.equal(Number(order.discount), 9000);
  assert.equal((await request(app).delete(admin(`/promos/${p.id}`)).set(auth)).status, 404);
});
