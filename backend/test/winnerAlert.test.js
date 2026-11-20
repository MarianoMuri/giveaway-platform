const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winner-alert-'));

const test = require('node:test');
const assert = require('node:assert');
const { sequelize, Raffle, Order, Chance, Draw } = require('../src/db');
const { mailer } = require('../src/services/mailer');
const winnerAlert = require('../src/services/winnerAlert');

async function setup() {
  await sequelize.sync({ force: true });
  const raffle = await Raffle.create({ title: 'Sorteo X', prize: 'AUDI TT', status: 'drawn', winnerNumber: 100000 });
  const order = await Order.create({
    RaffleId: raffle.id, buyerName: 'Prueba <Uno>', buyerEmail: 'uno@test.com', buyerPhone: '2914000001', buyerDni: '11111111',
    buyerProvince: 'B', chances: 3, firstNumber: 100000, lastNumber: 100002, courseTitle: 'Curso', amount: 1000, status: 'manual',
  });
  await Chance.create({ RaffleId: raffle.id, number: 100000, status: 'valid', OrderId: order.id });
  const draw = await Draw.create({ RaffleId: raffle.id, number: 100000, method: 'random', actor: 'admin', ...winnerAlert.pendingFields() });
  return { raffle, draw };
}

// Reemplaza el envío de mails por una función de prueba y lo restaura al terminar
async function withMailer(fn, body) {
  const original = mailer.send;
  mailer.send = fn;
  try { return await body(); } finally { mailer.send = original; }
}

test('el aviso queda pendiente en la base y llega con todos los datos del formulario', async () => {
  const { draw } = await setup();
  assert.strictEqual(draw.alertStatus, 'pending');
  const sent = [];
  const r = await withMailer(async (m) => { sent.push(m); return { id: 'x' }; }, () => winnerAlert.deliver(draw.id));
  assert.strictEqual(r, 'sent');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'admin@test');
  for (const dato of ['Prueba <Uno>', '11111111', 'uno@test.com', '2914000001', 'Buenos Aires', '100000', 'Curso']) assert.ok(sent[0].text.includes(dato), `falta ${dato}`);
  assert.ok(!sent[0].html.includes('<Uno>'), 'el nombre debe ir escapado en el HTML');
  assert.strictEqual((await Draw.findByPk(draw.id)).alertStatus, 'sent');
});

test('si el envío falla se reintenta más tarde y no se pierde; si el servidor reinicia, el worker lo retoma', async () => {
  const { draw } = await setup();
  assert.strictEqual(await withMailer(async () => { throw new Error('proveedor caído'); }, () => winnerAlert.deliver(draw.id)), 'retry');
  let row = await Draw.findByPk(draw.id);
  assert.strictEqual(row.alertStatus, 'pending');
  assert.strictEqual(row.alertAttempts, 1);
  assert.match(row.alertLastError, /proveedor caído/);
  assert.ok(new Date(row.alertNextAttemptAt) > new Date(), 'el reintento queda para más adelante');

  // todavía no le toca: no se envía
  const sent = [];
  const ok = async (m) => { sent.push(m); return { id: 'x' }; };
  assert.deepStrictEqual(await withMailer(ok, () => winnerAlert.processPending()), []);

  // pasa el tiempo de espera: el worker lo envía una sola vez
  await Draw.update({ alertNextAttemptAt: new Date(Date.now() - 1000) }, { where: { id: draw.id } });
  assert.deepStrictEqual(await withMailer(ok, () => winnerAlert.processPending()), ['sent']);
  assert.deepStrictEqual(await withMailer(ok, () => winnerAlert.processPending()), []);
  assert.strictEqual(sent.length, 1);
});

test('tras todos los intentos queda como fallido y un sorteo reemplazado no avisa', async () => {
  const { draw } = await setup();
  await Draw.update({ alertAttempts: winnerAlert.MAX_ATTEMPTS - 1 }, { where: { id: draw.id } });
  assert.strictEqual(await withMailer(async () => { throw new Error('x'); }, () => winnerAlert.deliver(draw.id)), 'failed');
  assert.strictEqual((await Draw.findByPk(draw.id)).alertStatus, 'failed');

  const { draw: old } = await setup();
  await old.update({ supersededAt: new Date() });
  const sent = [];
  assert.strictEqual(await withMailer(async (m) => { sent.push(m); }, () => winnerAlert.deliver(old.id)), 'skipped');
  assert.strictEqual(sent.length, 0);
});
