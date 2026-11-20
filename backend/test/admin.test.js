const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-test-'));

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { sequelize, Order } = require('../src/db');
const { voidNumbers } = require('../src/services/numbers');

let auth, raffleId, courseId;

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('login del administrador', async () => {
  const bad = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'mal' });
  assert.equal(bad.status, 401);
  const ok = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  assert.equal(ok.status, 200);
  auth = { Authorization: `Bearer ${ok.body.token}` };
  assert.equal((await request(app).get('/api/admin/raffles')).status, 401);
});

test('crear sorteo: arranca en borrador y valida los datos', async () => {
  assert.equal((await request(app).post('/api/admin/raffles').set(auth).send({ title: 'Sin premio' })).status, 400);
  assert.equal((await request(app).post('/api/admin/raffles').set(auth).send({ title: 'X', prize: 'Y', chancesGoal: -3 })).status, 400);

  const res = await request(app).post('/api/admin/raffles').set(auth).send({
    title: 'Gran Sorteo', prize: 'Auto 0km', chancesGoal: 5000, permitNumber: 'LOT-123', status: 'active',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'draft'); // se ignora el estado enviado
  raffleId = res.body.id;
  assert.equal((await request(app).get(`/api/raffles/${raffleId}`)).status, 404);

  const course = await request(app).post('/api/admin/courses').set(auth)
    .field('title', 'Herrería').attach('pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'herreria.pdf');
  courseId = course.body.id;
});

test('publicar: la vista pública trae el precio desde y no las chances vendidas', async () => {
  const pub = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'active', permitNumber: 'TEST-1', terms: 'x'.repeat(120) });
  assert.equal(pub.status, 200);
  const res = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.chancesGoal, res.body.chancesSold, res.body.fromPrice], [5000, undefined, 15000]);
  const list = await request(app).get('/api/raffles');
  assert.equal(list.body.length, 1);
});

test('editar nombre y premio: se guardan sin espacios sobrantes y no pueden quedar vacíos', async () => {
  const patch = (body) => request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send(body);
  const ok = await patch({ title: '  Gran Sorteo Verano  ', prize: 'Auto 0 km' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, 'Gran Sorteo Verano');
  assert.equal((await patch({ title: '   ' })).status, 400);
  assert.equal((await patch({ prize: '' })).status, 400);
  assert.equal((await patch({ title: 'x'.repeat(201) })).status, 400);
});

test('el estado "sorteado" no se puede poner a mano', async () => {
  const res = await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'drawn' });
  assert.equal(res.status, 400);
});

test('venta manual: asigna números en el acto y continúa la numeración', async () => {
  const bad = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 10, amount: 25000, buyer: { name: 'Ana Gómez', dni: '30111222' } });
  assert.equal(bad.status, 400); // falta el curso

  const a = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 10, courseId, amount: 25000, buyer: { name: 'Ana Gómez', dni: '30.111.222', phone: '2914000000' } });
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.status, a.body.firstNumber, a.body.lastNumber], ['manual', 100000, 100009]);
  assert.equal(a.body.courseTitle, 'Herrería');

  const b = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 5, courseId, amount: 15000, buyer: { name: 'Luis Díaz', dni: '28999888' } });
  assert.deepEqual([b.body.firstNumber, b.body.lastNumber], [100010, 100014]);
});

test('estadísticas del sorteo', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth);
  assert.deepEqual(res.body, { chancesSold: 15, purchases: 2, pending: 0, review: 0, revenue: 40000, freeEntries: 0, reversed: 0, winnerVoided: false, emailsPending: 0, emailsFailed: 0 });
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.equal(pub.body.chancesSold, undefined); // el público no ve las vendidas
});

test('"dónde compran": suma compras, chances y plata por provincia (las anuladas no cuentan)', async () => {
  const { Order, FreeEntry, Raffle } = require('../src/db');
  const r = await Raffle.create({ title: 'Prov', prize: 'x', status: 'active' });
  const mk = (province, chances, amount, status = 'approved') => Order.create({ RaffleId: r.id, buyerName: 'T', buyerEmail: 't@t.com', buyerPhone: '1', buyerDni: '1', buyerProvince: province, chances, amount, status });
  await mk('B', 5, 15000);
  await mk('B', 10, 25000);
  await mk('A', 5, 15000);
  await mk(null, 5, 10000, 'manual'); // sin provincia: "Sin dato"
  await mk('B', 50, 90000, 'refunded'); // anulada: no cuenta
  await mk('A', 5, 15000, 'pending'); // sin pagar: no cuenta
  await FreeEntry.create({ RaffleId: r.id, name: 'G', dni: '2', email: 'g@t.com', province: 'B', status: 'confirmed' });
  const res = await request(app).get(`/api/admin/raffles/${r.id}/by-province`).set(auth);
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.provinces.map((p) => [p.name, p]));
  assert.deepEqual([byName['Buenos Aires'].purchases, byName['Buenos Aires'].chances, byName['Buenos Aires'].revenue, byName['Buenos Aires'].freeEntries], [2, 15, 40000, 1]);
  assert.deepEqual([byName.Salta.purchases, byName.Salta.revenue], [1, 15000]);
  assert.equal(byName['Sin dato'].purchases, 1);
  assert.equal(res.body.totalRevenue, 65000);
  assert.equal(res.body.provinces[0].name, 'Buenos Aires'); // la que más plata trae, primero
  assert.equal((await request(app).get(`/api/admin/raffles/${r.id}/by-province`)).status, 401);
});

test('exportación CSV con curso y rango de números', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /"Ana Gómez";"30111222";"2914000000";"-";"Herrería";"10";"100000";"100009";"25000.00";"manual"/);
});

test('ganador: un número sin asignar o anulado no cuenta', async () => {
  await request(app).patch(`/api/admin/raffles/${raffleId}`).set(auth).send({ status: 'closed' }); // se sortea con la venta cerrada
  const none = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: 999999 });
  assert.equal(none.status, 400);

  const luis = await Order.findOne({ where: { buyerName: 'Luis Díaz' } });
  await voidNumbers(luis.id);
  const voided = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: 100012 });
  assert.equal(voided.status, 409);
});

test('ganador: devuelve los datos del comprador y cierra el sorteo', async () => {
  const res = await request(app).post(`/api/admin/raffles/${raffleId}/winner`).set(auth).send({ number: 100004 });
  assert.equal(res.status, 200);
  assert.equal(res.body.winner.name, 'Ana Gómez');
  assert.equal(res.body.winner.dni, '30111222');
  const pub = await request(app).get(`/api/raffles/${raffleId}`);
  assert.deepEqual([pub.body.status, pub.body.winnerNumber], ['drawn', 100004]);

  const late = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 5, courseId, amount: 1, buyer: { name: 'Tarde Pérez', dni: '30111222' } });
  assert.equal(late.status, 409);
});

test('listado de compras del sorteo', async () => {
  const res = await request(app).get(`/api/admin/orders?raffleId=${raffleId}&status=manual`).set(auth);
  assert.equal(res.body.length, 2);
});
