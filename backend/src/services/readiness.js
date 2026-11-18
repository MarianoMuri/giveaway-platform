const { Op } = require('sequelize');
const { Raffle, Order, Chance, FreeEntry } = require('../db');
const config = require('../config');
const { HttpError } = require('./errors');
const { mp } = require('./mercadopago');
const { handlePayment } = require('./orders');
const sales = require('./sales');

const IN_PROCESS = ['pending', 'in_process', 'authorized', 'in_mediation'];
const CONCURRENCY = 8;
const MAX_CHECKS = 2000;

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Control previo al sorteo ("¿están todos los clientes cargados?").
// 1) Para cada compra iniciada y sin pago registrado (dentro de las últimas horas), le pregunta a
//    Mercado Pago si existe un pago: si está aprobado lo carga (como si hubiera llegado el aviso).
// 2) Devuelve el resumen. "ready" solo es true con la venta cerrada y nada pendiente de resolver.
async function check(raffleId) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const now = new Date();
  const since = new Date(now.getTime() - config.pendingGraceHours * 3600 * 1000);

  const pending = await Order.findAll({
    where: { RaffleId: raffle.id, status: 'pending', createdAt: { [Op.gte]: since } },
    order: [['createdAt', 'ASC']],
    limit: MAX_CHECKS + 1,
  });
  const toCheck = pending.slice(0, MAX_CHECKS);
  const found = { recovered: 0, awaiting: 0, noPayment: 0, errors: 0 };
  await inBatches(toCheck, CONCURRENCY, async (order) => {
    try {
      const payments = await mp.searchPayments(order.id);
      const approved = payments.find((p) => p.status === 'approved');
      if (approved) {
        await handlePayment(approved.id);
        found.recovered += 1;
      } else if (payments.some((p) => IN_PROCESS.includes(p.status))) {
        found.awaiting += 1; // ej. pago en efectivo que todavía no se acreditó
      } else {
        found.noPayment += 1; // entró al checkout y no pagó (o lo rechazaron)
      }
    } catch (e) {
      found.errors += 1;
    }
  });
  const notChecked = Math.max(0, pending.length - MAX_CHECKS);

  const [needsReview, abandoned, unconfirmedFree, validPaid, validFree] = await Promise.all([
    Order.count({ where: { RaffleId: raffle.id, status: 'needs_review' } }),
    Order.count({ where: { RaffleId: raffle.id, status: 'pending', createdAt: { [Op.lt]: since } } }),
    FreeEntry.count({ where: { RaffleId: raffle.id, status: 'unconfirmed', tokenExpiresAt: { [Op.gt]: now } } }),
    Chance.count({ where: { RaffleId: raffle.id, status: 'valid', OrderId: { [Op.ne]: null } } }),
    Chance.count({ where: { RaffleId: raffle.id, status: 'valid', FreeEntryId: { [Op.ne]: null } } }),
  ]);

  const salesClosed = !sales.isOpen(raffle, now) && raffle.status !== 'draft';
  const blockers = [];
  if (!salesClosed) blockers.push('La venta sigue abierta');
  if (found.awaiting) blockers.push(`${found.awaiting} pago(s) en proceso en Mercado Pago`);
  if (needsReview) blockers.push(`${needsReview} compra(s) para revisar (monto distinto)`);
  if (found.errors) blockers.push(`No se pudo consultar ${found.errors} compra(s) en Mercado Pago: volvé a consultar`);
  if (notChecked) blockers.push(`${notChecked} compra(s) sin consultar: volvé a consultar`);

  return {
    checkedAt: now.toISOString(),
    salesClosed,
    salesCloseAt: raffle.salesCloseAt,
    checked: toCheck.length,
    recovered: found.recovered,
    awaiting: found.awaiting,
    noPayment: found.noPayment,
    errors: found.errors,
    notChecked,
    needsReview,
    abandoned,
    unconfirmedFree,
    validChances: validPaid + validFree,
    paidChances: validPaid,
    freeChances: validFree,
    ready: blockers.length === 0,
    blockers,
  };
}

module.exports = { check };
