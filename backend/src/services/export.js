const { Op } = require('sequelize');
const config = require('../config');
const { Order, FreeEntry } = require('../db');

// Exportación del listado completo de un sorteo (compras, anuladas y participaciones gratuitas) en un solo CSV.
// Se genera en streaming: se lee la base por tandas y cada tanda se escribe a medida que está lista, así la
// memoria del servidor no crece con el tamaño del sorteo (con cientos de miles de filas, armar el archivo
// entero en memoria lo agotaría y haría esperar al administrador hasta el final).

const HEADER = ['Fecha', 'Nombre', 'DNI', 'Teléfono', 'Email', 'Curso', 'Chances', 'Desde', 'Hasta', 'Monto', 'Estado', 'Pago MP', 'Anulada el', 'Motivo'];
const ORDER_STATUSES = ['approved', 'manual', 'needs_review', 'refunded', 'charged_back'];

// Los nombres y emails los escribe el público: una celda que empiece con = + @ se abriría como fórmula en Excel
const safe = (v) => (/^[=+@\t\r]|^-./.test(String(v ?? '')) ? `'${v}` : v);
const esc = (v) => `"${String(safe(v) ?? '').replace(/"/g, '""')}"`;
const iso = (d) => (d ? d.toISOString() : '');
const line = (cells) => cells.map(esc).join(';');

const orderLine = (o) =>
  line([iso(o.createdAt), o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail, o.courseTitle,
    o.chances, o.firstNumber, o.lastNumber, Number(o.amount).toFixed(2), o.status, o.mpPaymentId, iso(o.voidedAt), o.voidReason]);

const freeLine = (f) =>
  line([iso(f.createdAt), f.name, f.dni, '', f.email, 'Participación gratuita', 1, f.number, f.number, '0.00',
    f.status === 'void' ? 'gratuita_anulada' : 'gratuita', '', '', '']);

// Recorre una tabla por tandas, en orden cronológico, con paginación por cursor (fecha + id) en vez de OFFSET:
// cada tanda parte de donde terminó la anterior, así el costo no crece y, aunque entren compras nuevas mientras se
// exporta, no se repite ni se saltea ninguna fila (varias filas pueden compartir la misma fecha: el id desempata).
async function* batches(model, where, size) {
  let last = null;
  for (;;) {
    const after = last
      ? { [Op.or]: [{ createdAt: { [Op.gt]: last.createdAt } }, { createdAt: last.createdAt, id: { [Op.gt]: last.id } }] }
      : {};
    const rows = await model.findAll({ where: { ...where, ...after }, order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: size });
    if (!rows.length) return;
    yield rows;
    if (rows.length < size) return;
    last = rows[rows.length - 1];
  }
}

// Escribe en la respuesta respetando la contrapresión: si el cliente descarga más lento de lo que se genera,
// se espera en vez de acumular en memoria. Devuelve false si el cliente cortó la descarga.
async function write(res, text) {
  if (res.destroyed || res.writableEnded) return false;
  if (res.write(text)) return !res.destroyed;
  await new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
  return !res.destroyed;
}

async function streamRaffleCsv(raffleId, res) {
  const size = config.export.batchSize;
  let started = false;
  const send = async (text) => {
    if (!started) {
      started = true;
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="sorteo-${raffleId}.csv"`);
      if (!(await write(res, `﻿${HEADER.join(';')}\n`))) return false;
    }
    return write(res, text);
  };

  try {
    const sources = [
      [Order, { RaffleId: raffleId, status: ORDER_STATUSES }, orderLine],
      [FreeEntry, { RaffleId: raffleId, status: ['confirmed', 'void'] }, freeLine],
    ];
    for (const [model, where, toLine] of sources) {
      for await (const rows of batches(model, where, size)) {
        if (!(await send(`${rows.map(toLine).join('\n')}\n`))) return; // el cliente cortó: no se sigue leyendo la base
      }
    }
    if (!started) await send(''); // sorteo sin filas: igual sale el encabezado
    res.end();
  } catch (err) {
    // Antes de enviar nada se puede responder con un error normal. Si ya se envió una parte, el archivo quedaría
    // truncado y parecería completo: se corta la conexión para que la descarga falle en vez de engañar.
    if (!started) throw err;
    console.error('[export] falló a mitad de la exportación', err);
    res.destroy(err);
  }
}

module.exports = { streamRaffleCsv };
