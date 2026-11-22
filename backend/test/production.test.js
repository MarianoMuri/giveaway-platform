const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/db');
const { productionProblems } = require('../src/productionCheck');

const ok = {
  DATABASE_URL: 'postgres://u:p@host:5432/db',
  ADMIN_EMAIL: 'admin@cliente.com.ar',
  ADMIN_PASSWORD_HASH: '$2a$10$abc',
  JWT_SECRET: 'x'.repeat(40),
  FRONTEND_URL: 'https://sorteos.cliente.com.ar',
  PUBLIC_API_URL: 'https://api.cliente.com.ar',
  MP_ACCESS_TOKEN: 'APP_USR-123',
  MP_WEBHOOK_SECRET: 'secreto',
  SMTP_URL: 'smtps://resend:key@smtp.resend.com:465',
  TURNSTILE_SECRET: 'ts',
  STORAGE_DIR: '/data/storage',
};

test('una configuración completa de producción no tiene problemas', () => {
  assert.deepEqual(productionProblems(ok), []);
});

test('avisa de cada variable que falta, todas juntas', () => {
  const problems = productionProblems({});
  for (const name of ['DATABASE_URL', 'ADMIN_PASSWORD_HASH', 'JWT_SECRET', 'MP_WEBHOOK_SECRET', 'RESEND_API_KEY o SMTP_URL', 'TURNSTILE_SECRET', 'STORAGE_DIR']) {
    assert.ok(problems.some((p) => p.startsWith(name)), `falta aviso de ${name}`);
  }
});

test('rechaza secretos débiles, URLs locales y credenciales de prueba', () => {
  assert.match(productionProblems({ ...ok, JWT_SECRET: 'corto' }).join(), /JWT_SECRET.*32/);
  assert.match(productionProblems({ ...ok, JWT_SECRET: 'cambiar-por-un-texto-largo-y-aleatorio' }).join(), /JWT_SECRET.*ejemplo/);
  assert.match(productionProblems({ ...ok, PUBLIC_API_URL: 'http://localhost:4000' }).join(), /PUBLIC_API_URL.*localhost/);
  assert.match(productionProblems({ ...ok, MP_ACCESS_TOKEN: 'TEST-123' }).join(), /credencial de prueba/);
});

test('un entorno de pruebas puede usar credenciales TEST- si lo declara', () => {
  assert.deepEqual(productionProblems({ ...ok, MP_ACCESS_TOKEN: 'TEST-123', ALLOW_MP_TEST: 'true' }), []);
});

test('GET /api/health responde ok con la base conectada', async () => {
  await sequelize.sync();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('GET /api/health responde 503 si no llega a la base', async (t) => {
  t.mock.method(sequelize, 'authenticate', async () => { throw new Error('sin conexión'); });
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false });
});
