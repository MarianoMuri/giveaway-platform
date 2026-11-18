process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.MP_ACCESS_TOKEN = 'TEST-token-secreto-123';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize } = require('../src/db');
const { mp } = require('../src/services/mercadopago');
const { mailer } = require('../src/services/mailer');
const health = require('../src/services/mpHealth');

const sent = [];
let pingResult;
mp.ping = async () => {
  if (pingResult) throw pingResult;
};
let mailFails = false;
mailer.send = async (msg) => {
  if (mailFails) throw new Error('SMTP caído');
  sent.push(msg);
  return { id: 'x' };
};

const t0 = new Date('2026-11-20T10:00:00Z');
const at = (min) => new Date(t0.getTime() + min * 60 * 1000);
const err = (status) => Object.assign(new Error('mp'), { status });

test.beforeEach(() => {
  health.reset();
  sent.length = 0;
  pingResult = null;
  mailFails = false;
  config.mpHealth.alertEmails = [];
});

test('clasifica: 401 y 403 son credenciales; el resto, Mercado Pago no disponible', () => {
  assert.equal(health.classify(err(401)), 'credentials');
  assert.equal(health.classify(err(403)), 'credentials');
  assert.equal(health.classify(err(500)), 'unavailable');
  assert.equal(health.classify(new Error('ECONNRESET')), 'unavailable');
  assert.equal(health.classify(Object.assign(new Error('x'), { cause: { status: 401 } })), 'credentials');
});

test('sin credenciales de Mercado Pago no chequea ni avisa', async () => {
  const token = config.mp.accessToken;
  config.mp.accessToken = undefined;
  let pinged = false;
  const original = mp.ping;
  mp.ping = async () => { pinged = true; };
  try {
    const s = await health.check(t0);
    assert.equal(s.status, 'not_configured');
    assert.equal(pinged, false);
  } finally {
    mp.ping = original;
    config.mp.accessToken = token;
  }
});

test('conexión sana: queda OK y no manda nada', async () => {
  const s = await health.check(t0);
  assert.equal(s.status, 'ok');
  assert.equal(s.reason, null);
  assert.equal(sent.length, 0);
});

test('un solo fallo no alarma; el segundo seguido marca la caída y avisa al administrador', async () => {
  await health.check(t0);
  pingResult = err(401);
  let s = await health.check(at(5));
  assert.equal(s.status, 'ok', 'un tropiezo aislado no cuenta como caída');
  assert.equal(s.consecutiveFailures, 1);
  assert.equal(sent.length, 0);

  s = await health.check(at(10));
  assert.equal(s.status, 'down');
  assert.match(s.reason, /rechazó las credenciales/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'admin@test.com');
  assert.match(sent[0].subject, /^Alerta: se cayó la conexión/);
  assert.match(sent[0].text, /no se pueden cobrar compras nuevas/);
});

test('un fallo de red se informa distinto a uno de credenciales', async () => {
  pingResult = new Error('ECONNRESET');
  await health.check(t0);
  const s = await health.check(at(5));
  assert.match(s.reason, /No se pudo comunicar/);
});

test('un aviso a la vez: no repite en cada chequeo y recuerda a las 6 horas', async () => {
  pingResult = err(500);
  await health.check(t0);
  await health.check(at(5));
  assert.equal(sent.length, 1);
  for (let m = 10; m <= 300; m += 5) await health.check(at(m)); // casi 5 horas
  assert.equal(sent.length, 1, 'no manda más mientras no pasen las 6 horas');
  await health.check(at(5 + 6 * 60));
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /sigue caído/);
});

test('al recuperarse avisa una sola vez y vuelve a estar listo para otra caída', async () => {
  pingResult = err(500);
  await health.check(t0);
  await health.check(at(5));
  pingResult = null;
  const s = await health.check(at(20));
  assert.equal(s.status, 'ok');
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /se recuperó/);
  await health.check(at(25));
  assert.equal(sent.length, 2, 'no repite el aviso de recuperación');

  pingResult = err(500);
  await health.check(at(30));
  await health.check(at(35));
  assert.equal(sent.length, 3);
  assert.match(sent[2].subject, /^Alerta/, 'una caída nueva vuelve a avisar como primera vez');
});

test('si el email del aviso falla, el monitor sigue y reintenta en el próximo chequeo', async () => {
  pingResult = err(500);
  mailFails = true;
  await health.check(t0);
  const s = await health.check(at(5));
  assert.equal(s.status, 'down');
  assert.equal(sent.length, 0);
  mailFails = false;
  await health.check(at(10));
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Alerta/);
});

test('ALERT_EMAILS reemplaza al email del administrador y admite varios', async () => {
  config.mpHealth.alertEmails = ['socio@cliente.com.ar', 'soporte@cliente.com.ar'];
  pingResult = err(500);
  await health.check(t0);
  await health.check(at(5));
  assert.equal(sent[0].to, 'socio@cliente.com.ar, soporte@cliente.com.ar');
});

test('el aviso no incluye el token ni credenciales', async () => {
  pingResult = err(401);
  await health.check(t0);
  await health.check(at(5));
  assert.ok(!/token-secreto|TEST-/.test(JSON.stringify(sent)));
});

test('panel: el estado exige sesión de admin, no expone el token y se puede forzar un chequeo', async () => {
  await sequelize.sync();
  assert.equal((await request(app).get('/api/admin/mp-status')).status, 401);
  assert.equal((await request(app).post('/api/admin/mp-status/check')).status, 401);

  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test.com', password: 'clave123' });
  const auth = { Authorization: `Bearer ${login.body.token}` };

  let res = await request(app).get('/api/admin/mp-status').set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'unknown', 'antes del primer chequeo');
  assert.ok(!/token-secreto|TEST-/.test(JSON.stringify(res.body)));

  res = await request(app).post('/api/admin/mp-status/check').set(auth);
  assert.equal(res.body.status, 'ok');
  assert.ok(res.body.checkedAt);

  pingResult = err(401);
  await request(app).post('/api/admin/mp-status/check').set(auth);
  res = await request(app).post('/api/admin/mp-status/check').set(auth);
  assert.equal(res.body.status, 'down');
  assert.equal((await request(app).get('/api/admin/mp-status').set(auth)).body.status, 'down');
});
