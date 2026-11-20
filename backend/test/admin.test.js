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
    .send({ raffleId, chances: 10, amount: 25000, buyer: { name: 'Ana Gómez', dni: '30111222', phone: '2914000000', email: 'ana@test.com', province: 'B' } });
  assert.equal(bad.status, 400); // falta el curso

  const a = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 10, courseId, amount: 25000, buyer: { name: 'Ana Gómez', dni: '30.111.222', phone: '2914000000', email: 'ana@test.com', province: 'B' } });
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.status, a.body.firstNumber, a.body.lastNumber], ['manual', 100000, 100009]);
  assert.equal(a.body.courseTitle, 'Herrería');

  const b = await request(app).post('/api/admin/orders/manual').set(auth)
    .send({ raffleId, chances: 5, courseId, amount: 15000, buyer: { name: 'Luis Díaz', dni: '28999888', phone: '2914000000', email: 'luis@test.com', province: 'B' } });
  assert.deepEqual([b.body.firstNumber, b.body.lastNumber], [100010, 100014]);
});

test('estadísticas del sorteo', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/stats`).set(auth);
  // el envío de mails es asíncrono: cuántos quedan pendientes depende del momento, no se compara
  const { emailsPending, ...stats } = res.body;
  assert.deepEqual(stats, { chancesSold: 15, purchases: 2, pending: 0, review: 0, revenue: 40000, freeEntries: 0, reversed: 0, winnerVoided: false, emailsFailed: 0 });
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
  const res = await request(app).get(`/api/admin/raffles/${r.id}/segments`).set(auth);
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.rows.map((p) => [p.name, p]));
  assert.deepEqual([byName['Buenos Aires'].purchases, byName['Buenos Aires'].chances, byName['Buenos Aires'].revenue, byName['Buenos Aires'].freeEntries], [2, 15, 40000, 1]);
  assert.deepEqual([byName.Salta.purchases, byName.Salta.revenue], [1, 15000]);
  assert.equal(byName['Sin dato'].purchases, 1);
  assert.equal(res.body.totalRevenue, 65000);
  assert.equal(res.body.rows[0].name, 'Buenos Aires'); // la que más plata trae, primero
  assert.equal((await request(app).get(`/api/admin/raffles/${r.id}/segments`)).status, 401);
});

test('segmentos: localidad agrupada sin importar tildes ni mayúsculas', async () => {
  const { Order, Raffle } = require('../src/db');
  const r = await Raffle.create({ title: 'Seg', prize: 'x', status: 'active' });
  const mk = (extra, amount = 10000) => Order.create({ RaffleId: r.id, buyerName: 'T', buyerEmail: 't@t.com', buyerPhone: '1', buyerDni: '1', chances: 5, amount, status: 'approved', ...extra });
  await mk({ locality: 'Bahía Blanca' });
  await mk({ locality: 'bahia blanca' });
  await mk({ locality: 'Punta Alta' }, 5000);
  await mk({}, 2000);
  const get = async (by) => (await request(app).get(`/api/admin/raffles/${r.id}/segments?by=${by}`).set(auth));
  const loc = (await get('locality')).body;
  assert.deepEqual(loc.rows.map((x) => [x.name, x.purchases]), [['Bahía Blanca', 2], ['Punta Alta', 1], ['Sin dato', 1]]);
  assert.equal((await get('dni')).status, 400);
  assert.equal((await get('gender')).status, 400); // edad, género y ocupación no se guardan
});

test('localidad opcional: se limpia y un valor inválido se descarta sin bloquear', () => {
  const { cleanProfile } = require('../src/services/profile');
  assert.deepEqual(cleanProfile({ locality: '  bahía   BLANCA ' }), { locality: 'Bahía Blanca' });
  assert.deepEqual(cleanProfile({ locality: 'x' }), { locality: null });
  assert.deepEqual(cleanProfile(undefined), { locality: null });
});

test('exportación CSV con curso y rango de números', async () => {
  const res = await request(app).get(`/api/admin/raffles/${raffleId}/export.csv`).set(auth);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /"Ana Gómez";"30111222";"2914000000";"ana@test.com";"Herrería";"10";"100000";"100009";"25000.00";"manual"/);
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
    .send({ raffleId, chances: 5, courseId, amount: 1, buyer: { name: 'Tarde Pérez', dni: '30111222', phone: '2914000000', email: 'tarde@test.com', province: 'B' } });
  assert.equal(late.status, 409);
});

test('listado de compras del sorteo', async () => {
  const res = await request(app).get(`/api/admin/orders?raffleId=${raffleId}&status=manual`).set(auth);
  assert.equal(res.body.length, 2);
});

test('operador del sorteo en vivo: solo puede ver la lista y sortear, sin datos personales del ganador', async () => {
  const config = require('../src/config');
  config.liveOperator.email = 'vivo@test';
  config.liveOperator.passwordHash = require('bcryptjs').hashSync('vivo123', 4);
  const { Raffle, Chance, FreeEntry } = require('../src/db');

  assert.equal((await request(app).post('/api/admin/login').send({ email: 'vivo@test', password: 'mal' })).status, 401);
  const login = await request(app).post('/api/admin/login').send({ email: 'vivo@test', password: 'vivo123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, 'live');
  const live = { Authorization: `Bearer ${login.body.token}` };
  const adminLogin = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  assert.equal(adminLogin.body.role, 'admin');

  // ve la lista, pero solo los datos básicos
  const list = await request(app).get('/api/admin/raffles').set(live);
  assert.equal(list.status, 200);
  assert.ok(list.body.length > 0);
  assert.deepEqual(Object.keys(list.body[0]).sort(), ['drawDate', 'id', 'prize', 'salesCloseAt', 'status', 'title', 'winnerNumber']);

  // todo lo demás está prohibido
  for (const [method, url] of [
    ['get', `/api/admin/raffles/${raffleId}/stats`], ['get', '/api/admin/orders'], ['get', '/api/admin/courses'],
    ['get', `/api/admin/raffles/${raffleId}/segments`], ['get', `/api/admin/raffles/${raffleId}/draws`],
    ['post', '/api/admin/orders/manual'], ['post', `/api/admin/raffles/${raffleId}/winner`], ['patch', `/api/admin/raffles/${raffleId}`], ['post', '/api/admin/raffles'],
  ]) {
    assert.equal((await request(app)[method](url).set(live).send({})).status, 403, `${method} ${url}`);
  }

  // sortea y recibe solo lo que se muestra en pantalla
  const r = await Raffle.create({ title: 'Vivo', prize: 'x', status: 'closed' });
  const f = await FreeEntry.create({ RaffleId: r.id, name: 'Marta Beatriz Ruiz', dni: '27111222', email: 'm@t.com', phone: '2914000000', status: 'confirmed' });
  await Chance.create({ RaffleId: r.id, number: 100000, status: 'valid', FreeEntryId: f.id });
  const res = await request(app).post(`/api/admin/raffles/${r.id}/draw`).set(live).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.winner, { name: 'Marta R.', dni: '222', source: 'free' });
  assert.equal(JSON.stringify(res.body).includes('2914000000'), false);
  assert.equal(JSON.stringify(res.body).includes('m@t.com'), false);

  // sin token o con el token de otro rol sigue igual
  assert.equal((await request(app).get('/api/admin/raffles')).status, 401);
  config.liveOperator.email = '';
  config.liveOperator.passwordHash = '';
  assert.equal((await request(app).post('/api/admin/login').send({ email: '', password: '' })).status, 401);
});
