const test = require('node:test');
const assert = require('node:assert');
const config = require('../src/config');
const { mailer } = require('../src/services/mailer');
const { productionProblems } = require('../src/productionCheck');

const realFetch = global.fetch;
const mail = { to: 'ana@test.com', subject: 'Tus números', html: '<p>hola</p>', text: 'hola' };

test.beforeEach(() => { config.mail.resendApiKey = 're_test_123'; config.mail.replyTo = undefined; });
test.afterEach(() => { global.fetch = realFetch; config.mail.resendApiKey = undefined; });

test('con RESEND_API_KEY el mail sale por la API HTTPS de Resend', async () => {
  let call;
  global.fetch = async (url, opts) => { call = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: 'abc-123' }) }; };
  const out = await mailer.send(mail);
  assert.equal(out.id, 'abc-123');
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.opts.headers.Authorization, 'Bearer re_test_123');
  const body = JSON.parse(call.opts.body);
  assert.deepEqual(body.to, ['ana@test.com']);
  assert.equal(body.subject, 'Tus números');
  assert.equal(body.from, config.mail.from);
  assert.equal(body.reply_to, undefined);
});

test('incluye reply_to si está configurado', async () => {
  config.mail.replyTo = 'ayuda@cliente.com';
  let body;
  global.fetch = async (_, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: 'x' }) }; };
  await mailer.send(mail);
  assert.equal(body.reply_to, 'ayuda@cliente.com');
});

test('límite del plan (429) o caída (5xx) lanzan error para que la cola reintente', async () => {
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ message: 'Too many requests' }) });
  await assert.rejects(() => mailer.send(mail), /Resend 429: Too many requests/);
  global.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error('no json'); } });
  await assert.rejects(() => mailer.send(mail), /Resend 503/);
});

test('si Resend no responde, lanza error claro', async () => {
  global.fetch = async () => { throw new Error('socket hang up'); };
  await assert.rejects(() => mailer.send(mail), /Resend no respondió: socket hang up/);
});

test('el chequeo de producción acepta RESEND_API_KEY o SMTP_URL, pero exige uno', () => {
  const base = {
    NODE_ENV: 'production', ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD_HASH: 'x', JWT_SECRET: 'k'.repeat(40),
    FRONTEND_URL: 'https://sorteos.com', PUBLIC_API_URL: 'https://api.sorteos.com', MP_ACCESS_TOKEN: 'APP_USR-1',
    MP_WEBHOOK_SECRET: 's', TURNSTILE_SECRET: 't', STORAGE_DIR: '/data/storage', DATABASE_URL: 'postgres://x',
  };
  const has = (env) => productionProblems(env).some((p) => /RESEND_API_KEY o SMTP_URL/.test(p));
  assert.equal(has(base), true);
  assert.equal(has({ ...base, RESEND_API_KEY: 're_1' }), false);
  assert.equal(has({ ...base, SMTP_URL: 'smtp://u:p@h:587' }), false);
});
