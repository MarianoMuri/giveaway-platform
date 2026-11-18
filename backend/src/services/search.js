const { Op, where, fn, col } = require('sequelize');
const { Order, Chance, FreeEntry } = require('../db');
const { HttpError } = require('./errors');

const LIMIT = 50;

// Texto para LIKE: se escapan % y _ para que se busquen literalmente
const like = (s) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const ci = (column, s) => where(fn('lower', col(column)), { [Op.like]: like(s) });

function orderCard(o, voidedNumbers) {
  return {
    kind: 'order',
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    buyerName: o.buyerName,
    buyerDni: o.buyerDni,
    buyerEmail: o.buyerEmail,
    buyerPhone: o.buyerPhone,
    courseTitle: o.courseTitle,
    chances: o.chances,
    amount: o.amount,
    firstNumber: o.firstNumber,
    lastNumber: o.lastNumber,
    voidedNumbers,
    mpPaymentId: o.mpPaymentId, // N° de operación en Mercado Pago
    mpStatusDetail: o.mpStatusDetail,
    voidedAt: o.voidedAt,
    voidReason: o.voidReason,
    emailStatus: o.emailStatus,
  };
}

function freeCard(f) {
  return {
    kind: 'free',
    id: f.id,
    status: f.status,
    createdAt: f.createdAt,
    name: f.name,
    dni: f.dni,
    email: f.email,
    number: f.number,
    confirmedAt: f.confirmedAt,
  };
}

// Buscador del panel: por número exacto, DNI exacto, o texto (email / nombre) dentro de un sorteo.
// Los números del sorteo tienen 6 dígitos (desde 100000) y los DNI 7 u 8, así que no se confunden.
async function search(raffleId, rawQuery) {
  const q = String(rawQuery || '').trim();
  if (q.length < 3) throw new HttpError(400, 'Escribí al menos 3 caracteres');
  if (q.length > 100) throw new HttpError(400, 'La búsqueda es demasiado larga');
  const digits = q.replace(/[.\s]/g, '');

  let type;
  let orderWhere;
  let freeWhere;
  let match = null;

  if (/^\d{6}$/.test(digits)) {
    type = 'number';
    const number = Number(digits);
    const chance = await Chance.findOne({ where: { RaffleId: raffleId, number } });
    if (!chance) return { type, query: q, match: null, results: [], truncated: false };
    match = { number, status: chance.status, voidedAt: chance.voidedAt, voidReason: chance.voidReason, source: chance.OrderId ? 'purchase' : 'free' };
    orderWhere = chance.OrderId ? { id: chance.OrderId } : null;
    freeWhere = chance.FreeEntryId ? { id: chance.FreeEntryId } : null;
  } else if (/^\d{7,8}$/.test(digits)) {
    type = 'dni';
    orderWhere = { buyerDni: digits };
    freeWhere = { dni: digits };
  } else {
    type = 'text';
    const text = q.toLowerCase();
    orderWhere = { [Op.or]: [ci('buyerEmail', text), ci('buyerName', text)] };
    freeWhere = { [Op.or]: [ci('email', text), ci('name', text)] };
  }

  const [orders, frees] = await Promise.all([
    orderWhere
      ? Order.findAll({ where: { RaffleId: raffleId, status: { [Op.ne]: 'rejected' }, ...orderWhere }, order: [['createdAt', 'DESC']], limit: LIMIT + 1 })
      : [],
    freeWhere ? FreeEntry.findAll({ where: { RaffleId: raffleId, status: { [Op.ne]: 'unconfirmed' }, ...freeWhere }, order: [['createdAt', 'DESC']], limit: LIMIT + 1 }) : [],
  ]);

  const shownOrders = orders.slice(0, LIMIT);
  const voided = shownOrders.length
    ? await Chance.findAll({
        where: { OrderId: shownOrders.map((o) => o.id), status: 'void' },
        attributes: ['OrderId'], raw: true,
      })
    : [];
  const voidedBy = new Map();
  for (const v of voided) voidedBy.set(v.OrderId, (voidedBy.get(v.OrderId) || 0) + 1);

  return {
    type,
    query: q,
    match,
    results: [...shownOrders.map((o) => orderCard(o, voidedBy.get(o.id) || 0)), ...frees.slice(0, LIMIT).map(freeCard)],
    truncated: orders.length > LIMIT || frees.length > LIMIT,
  };
}

module.exports = { search };
