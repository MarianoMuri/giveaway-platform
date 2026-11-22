const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'twofactor-test-'));

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/db');

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

test('doble verificación: el administrador necesita el código si está activada; el operador en vivo no', async () => {
  const config = require('../src/config');
  const totp = require('../src/services/totp');
  const secret = totp.generateSecret();
  config.admin.totpSecret = secret;
  const base = { email: 'admin@test', password: 'clave123' };
  const step = Math.floor(Date.now() / 1000 / totp.STEP_SECONDS);

  const sin = await request(app).post('/api/admin/login').send(base);
  assert.equal(sin.status, 401);
  assert.equal(sin.body.needsCode, true);
  assert.equal(sin.body.token, undefined);

  const mal = await request(app).post('/api/admin/login').send({ ...base, code: '000000' });
  assert.equal(mal.status, 401);

  const ok = await request(app).post('/api/admin/login').send({ ...base, code: totp.codeAt(secret, step) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.role, 'admin');

  // el mismo código no sirve dos veces
  const repetido = await request(app).post('/api/admin/login').send({ ...base, code: totp.codeAt(secret, step) });
  assert.equal(repetido.status, 401);

  // la contraseña mala sigue dando "Credenciales inválidas", sin revelar nada del código
  const mala = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'mal', code: totp.codeAt(secret, step + 1) });
  assert.equal(mala.status, 401);
  assert.equal(mala.body.needsCode, undefined);

  // el operador del sorteo en vivo no usa código
  config.liveOperator.email = 'vivo3@test';
  config.liveOperator.passwordHash = require('bcryptjs').hashSync('vivo123', 4);
  assert.equal((await request(app).post('/api/admin/login').send({ email: 'vivo3@test', password: 'vivo123' })).status, 200);
  config.liveOperator.email = '';
  config.liveOperator.passwordHash = '';
  config.admin.totpSecret = '';
});

test('totp: coincide con los vectores de la RFC 6238 (SHA1)', () => {
  const totp = require('../src/services/totp');
  // secreto de la RFC "12345678901234567890" en base32; códigos de 6 dígitos de sus pruebas
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.codeAt(secret, Math.floor(1234567890 / 30)), '005924');
});

test('doble verificación: si la clave cargada es inválida, avisa claro y no deja entrar', async () => {
  const config = require('../src/config');
  config.admin.totpSecret = '"CLAVE-CON-COMILLAS-1"';
  const res = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123', code: '123456' });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /ADMIN_TOTP_SECRET/);
  assert.equal(res.body.token, undefined);
  config.admin.totpSecret = '';
});
