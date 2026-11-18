process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Raffle, Order, FreeEntry } = require('../src/db');
const { streamRaffleCsv } = require('../src/services/export');

let auth;
let raffle;
const csvUrl = () => `/api/admin/raffles/${raffle.id}/export.csv`;
const dataLines = (text) => text.replace(/^﻿/, '').trim().split('\n').slice(1);

// Respuesta simulada para probar el streaming sin red
function fakeRes(opts = {}) {
  const res = new EventEmitter();
  Object.assign(res, {
    chunks: [], headers: {}, ended: false, destroyed: false, writableEnded: false, destroyedWith: null,
    set(k, v) { this.headers[k] = v; },
    write(t) {
      this.chunks.push(t);
      if (opts.stopAfter && this.chunks.length >= opts.stopAfter) this.destroyed = true;
      if (opts.backpressureOnce && this.chunks.length === 2) {
        setTimeout(() => this.emit('drain'), opts.backpressureOnce);
        return false;
      }
      return true;
    },
    end() { this.ended = true; this.writableEnded = true; },
    destroy(err) { this.destroyed = true; this.destroyedWith = err; },
  });
  return res;
}

// Cuenta las lecturas a la base y el tamaño de cada una
function spyFindAll(model, calls) {
  const original = model.findAll.bind(model);
  model.findAll = async (opts) => {
    calls.push(opts.limit);
    return original(opts);
  };
  return () => { model.findAll = original; };
}

async function addOrders(n, { sameInstant = false, status = 'approved', RaffleId = raffle.id, prefix = 'C' } = {}) {
  const base = Date.UTC(2026, 10, 1);
  const rows = Array.from({ length: n }, (_, i) => ({
    RaffleId, buyerName: `${prefix}${i}`, buyerEmail: `${prefix.toLowerCase()}${i}@test.com`, buyerPhone: '1', buyerDni: `${prefix}-${i}`,
    amount: 1000, status, chances: 1, firstNumber: 100000 + i, lastNumber: 100000 + i,
    createdAt: new Date(sameInstant ? base : base + i * 1000), updatedAt: new Date(),
  }));
  for (let i = 0; i < rows.length; i += 500) await Order.bulkCreate(rows.slice(i, i + 500));
}
async function addFree(n, { status = 'confirmed', prefix = 'F' } = {}) {
  const base = Date.UTC(2026, 10, 2);
  const rows = Array.from({ length: n }, (_, i) => ({
    RaffleId: raffle.id, name: `${prefix}${i}`, dni: `${prefix}-${i}`, email: `${prefix.toLowerCase()}${i}@test.com`, status,
    number: 200000 + i, createdAt: new Date(base + i * 1000), updatedAt: new Date(),
  }));
  for (let i = 0; i < rows.length; i += 500) await FreeEntry.bulkCreate(rows.slice(i, i + 500));
}

test.before(async () => {
  await sequelize.sync();
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
});
test.beforeEach(async () => {
  await Order.destroy({ where: {} });
  await FreeEntry.destroy({ where: {} });
  raffle = await Raffle.create({ title: 'Sorteo', prize: 'Auto', status: 'active' });
  config.export.batchSize = 200;
});

test('un sorteo grande sale completo, en orden y sin repetir ni saltear filas entre tandas', async () => {
  await addOrders(1300);
  await addFree(700);
  const calls = [];
  const restoreO = spyFindAll(Order, calls);
  const restoreF = spyFindAll(FreeEntry, calls);
  let res;
  try {
    res = await request(app).get(csvUrl()).set(auth);
  } finally {
    restoreO();
    restoreF();
  }
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /sorteo-\d+\.csv/);
  const lines = dataLines(res.text);
  assert.equal(lines.length, 2000);
  assert.equal(new Set(lines.map((l) => l.split(';')[2])).size, 2000, 'cada DNI aparece una sola vez');
  assert.match(lines[0], /^"2026-11-01T00:00:00\.000Z";"C0"/, 'las compras primero, de la más vieja a la más nueva');
  assert.match(lines[1299], /"C1299"/);
  assert.match(lines[1300], /"F0".*"Participación gratuita"/, 'después, las participaciones gratuitas');
  assert.ok(calls.every((l) => l === 200), 'ninguna lectura trae más filas que la tanda configurada');
  assert.ok(calls.length >= 7 + 4, `se leyó por tandas (${calls.length} lecturas)`);
});

test('muchas filas con la misma fecha no se pierden ni se repiten al cortar la tanda', async () => {
  await addOrders(650, { sameInstant: true });
  const res = await request(app).get(csvUrl()).set(auth);
  const dnis = dataLines(res.text).map((l) => l.split(';')[2]);
  assert.equal(dnis.length, 650);
  assert.equal(new Set(dnis).size, 650);
});

test('exporta solo lo que corresponde: sin pendientes, rechazadas, sin confirmar ni de otros sorteos', async () => {
  const other = await Raffle.create({ title: 'Otro', prize: 'Moto', status: 'active' });
  await addOrders(3, { prefix: 'OK' });
  await addOrders(2, { prefix: 'PEN', status: 'pending' });
  await addOrders(2, { prefix: 'REJ', status: 'rejected' });
  await addOrders(2, { prefix: 'REF', status: 'refunded' });
  await addOrders(2, { prefix: 'OTRO', RaffleId: other.id });
  await addFree(2, { prefix: 'FC' });
  await addFree(2, { prefix: 'FU', status: 'unconfirmed' });
  await addFree(1, { prefix: 'FV', status: 'void' });
  const text = (await request(app).get(csvUrl()).set(auth)).text;
  assert.equal(dataLines(text).length, 3 + 2 + 2 + 1);
  assert.doesNotMatch(text, /PEN-|REJ-|OTRO-|FU-/);
  assert.match(text, /"FV-0".*"gratuita_anulada"/);
});

test('sorteo sin filas: sale solo el encabezado; sin sesión de admin, 401', async () => {
  const res = await request(app).get(csvUrl()).set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.text.replace(/^﻿/, '').trim(), 'Fecha;Nombre;DNI;Teléfono;Email;Curso;Chances;Desde;Hasta;Monto;Estado;Pago MP;Anulada el;Motivo');
  assert.equal((await request(app).get(csvUrl())).status, 401);
});

test('las celdas con fórmulas se neutralizan también en las tandas siguientes', async () => {
  await addOrders(450);
  await Order.update({ buyerName: '=HYPERLINK("http://x")', buyerEmail: '+cmd@test.com' }, { where: { buyerDni: 'C-420' } });
  const text = (await request(app).get(csvUrl()).set(auth)).text;
  assert.match(text, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(text, /"'\+cmd@test\.com"/);
});

test('si el cliente corta la descarga, se deja de leer la base', async () => {
  await addOrders(1000);
  const calls = [];
  const restore = spyFindAll(Order, calls);
  const res = fakeRes({ stopAfter: 2 }); // encabezado + primera tanda
  try {
    await streamRaffleCsv(raffle.id, res);
  } finally {
    restore();
  }
  assert.equal(calls.length, 1, 'no pidió la segunda tanda');
  assert.equal(res.ended, false);
});

test('contrapresión: si el cliente descarga lento, no se sigue leyendo hasta que se libera', async () => {
  await addOrders(1000);
  const calls = [];
  const restore = spyFindAll(Order, calls);
  const res = fakeRes({ backpressureOnce: 150 });
  const t0 = Date.now();
  let readsWhileBlocked;
  const done = streamRaffleCsv(raffle.id, res);
  await new Promise((r) => setTimeout(r, 60));
  readsWhileBlocked = calls.length;
  await done;
  restore();
  assert.equal(readsWhileBlocked, 1, 'quedó esperando el "drain" con una sola tanda leída');
  assert.ok(Date.now() - t0 >= 140);
  assert.equal(res.ended, true);
  assert.equal(dataLines(res.chunks.join('')).length, 1000);
});

test('si falla antes de enviar algo, responde un error normal', async () => {
  await addOrders(5);
  const original = Order.findAll;
  Order.findAll = async () => { throw new Error('base caída'); };
  try {
    const res = await request(app).get(csvUrl()).set(auth);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Error interno' });
  } finally {
    Order.findAll = original;
  }
});

test('si falla a mitad de la exportación, corta la conexión: nunca queda un archivo truncado que parezca completo', async () => {
  await addOrders(500);
  const original = Order.findAll;
  let n = 0;
  Order.findAll = async (opts) => {
    n += 1;
    if (n === 2) throw new Error('base caída a mitad');
    return original.call(Order, opts);
  };
  const res = fakeRes();
  const log = console.error;
  console.error = () => {};
  try {
    await streamRaffleCsv(raffle.id, res);
  } finally {
    Order.findAll = original;
    console.error = log;
  }
  assert.equal(res.ended, false, 'no se cierra como si hubiera terminado bien');
  assert.match(res.destroyedWith.message, /base caída/);
  assert.equal(dataLines(res.chunks.join('')).length, 200, 'solo salió la primera tanda');
});
