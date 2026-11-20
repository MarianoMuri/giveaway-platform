const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winner-alert-'));

const test = require('node:test');
const assert = require('node:assert');
const { sequelize, Raffle, Order, Chance } = require('../src/db');
const { mailer } = require('../src/services/mailer');
const winnerAlert = require('../src/services/winnerAlert');

test('el aviso al administrador lleva todos los datos del formulario del ganador', async () => {
  await sequelize.sync({ force: true });
  const raffle = await Raffle.create({ title: 'Sorteo X', prize: 'AUDI TT', status: 'drawn', winnerNumber: 100000 });
  const order = await Order.create({
    RaffleId: raffle.id, buyerName: 'Prueba <Uno>', buyerEmail: 'uno@test.com', buyerPhone: '2914000001', buyerDni: '11111111',
    buyerProvince: 'B', chances: 3, firstNumber: 100000, lastNumber: 100002, courseTitle: 'Curso', amount: 1000, status: 'manual',
  });
  await Chance.create({ RaffleId: raffle.id, number: 100000, status: 'valid', OrderId: order.id });

  const sent = [];
  const original = mailer.send;
  mailer.send = async (m) => { sent.push(m); return { id: 'x' }; };
  try {
    const r = await winnerAlert.send(raffle.id, { number: 100000, winner: { source: 'purchase', orderId: order.id } });
    assert.strictEqual(r, 'sent');
  } finally {
    mailer.send = original;
  }
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'admin@test');
  for (const dato of ['Prueba <Uno>', '11111111', 'uno@test.com', '2914000001', 'Buenos Aires', '100000', 'Curso']) assert.ok(sent[0].text.includes(dato), `falta ${dato}`);
  assert.ok(!sent[0].html.includes('<Uno>'), 'el nombre debe ir escapado en el HTML');
});
