const { Op } = require('sequelize');
const { sequelize, Raffle, Order, Ticket } = require('../db');
const { mp } = require('./mercadopago');
const config = require('../config');
const { computeTotal, validatePromos } = require('./pricing');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Un número está libre si está "available" o si su reserva ya venció.
const freeCondition = () => ({
  [Op.or]: [
    { status: 'available' },
    { status: 'reserved', reservedUntil: { [Op.lt]: new Date() } },
  ],
});

async function createRaffle(data) {
  let promos;
  try {
    promos = validatePromos(data.promos);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  return sequelize.transaction(async (t) => {
    const raffle = await Raffle.create({ ...data, promos }, { transaction: t });
    const rows = Array.from({ length: raffle.totalNumbers }, (_, i) => ({ RaffleId: raffle.id, number: i + 1 }));
    for (let i = 0; i < rows.length; i += 1000) {
      await Ticket.bulkCreate(rows.slice(i, i + 1000), { transaction: t });
    }
    return raffle;
  });
}

async function reserveAndCreateOrder({ raffleId, numbers, buyer }) {
  const unique = [...new Set((numbers || []).map(Number))].filter(Number.isInteger);
  if (unique.length === 0) throw new HttpError(400, 'Elegí al menos un número');
  if (unique.length > config.maxNumbersPerOrder) {
    throw new HttpError(400, `Máximo ${config.maxNumbersPerOrder} números por compra`);
  }
  for (const f of ['name', 'email', 'phone', 'dni']) {
    if (!buyer || !String(buyer[f] || '').trim()) throw new HttpError(400, `Falta el dato: ${f}`);
  }

  const { order, raffle } = await sequelize.transaction(async (t) => {
    const raffle = await Raffle.findByPk(raffleId, { transaction: t });
    if (!raffle || raffle.status !== 'active') throw new HttpError(404, 'Sorteo no disponible');

    // FOR UPDATE: bloquea las filas para que dos compradores no tomen el mismo número
    const tickets = await Ticket.findAll({
      where: { RaffleId: raffle.id, number: unique, ...freeCondition() },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (tickets.length !== unique.length) {
      const free = new Set(tickets.map((x) => x.number));
      throw new HttpError(409, 'Algunos números ya no están disponibles', {
        unavailable: unique.filter((n) => !free.has(n)),
      });
    }

    const expiresAt = new Date(Date.now() + config.reservationMinutes * 60 * 1000);
    const order = await Order.create(
      {
        RaffleId: raffle.id,
        buyerName: buyer.name.trim(),
        buyerEmail: buyer.email.trim().toLowerCase(),
        buyerPhone: buyer.phone.trim(),
        buyerDni: String(buyer.dni).trim(),
        numbers: unique.sort((a, b) => a - b),
        amount: computeTotal(raffle.pricePerNumber, raffle.promos, unique.length).total.toFixed(2),
        expiresAt,
      },
      { transaction: t }
    );
    await Ticket.update(
      { status: 'reserved', reservedUntil: expiresAt, OrderId: order.id },
      { where: { id: tickets.map((x) => x.id) }, transaction: t }
    );
    return { order, raffle };
  });

  try {
    const pref = await mp.createPreference({ order, raffle });
    await order.update({ mpPreferenceId: pref.id });
    return { orderId: order.id, checkoutUrl: pref.initPoint, expiresAt: order.expiresAt };
  } catch (err) {
    await releaseOrder(order.id, 'expired');
    throw new HttpError(502, 'No se pudo iniciar el pago con Mercado Pago', { detail: err.message });
  }
}

async function releaseOrder(orderId, newStatus) {
  await sequelize.transaction(async (t) => {
    await Ticket.update(
      { status: 'available', reservedUntil: null, OrderId: null },
      { where: { OrderId: orderId, status: 'reserved' }, transaction: t }
    );
    await Order.update({ status: newStatus }, { where: { id: orderId, status: 'pending' }, transaction: t });
  });
}

// Procesa una notificación de pago. Idempotente: MP puede mandar la misma varias veces.
async function handlePayment(paymentId) {
  const payment = await mp.getPayment(paymentId);
  if (!payment.externalReference) return { ignored: true };

  return sequelize.transaction(async (t) => {
    const order = await Order.findByPk(payment.externalReference, { lock: t.LOCK.UPDATE, transaction: t });
    if (!order) return { ignored: true };
    if (['approved', 'needs_review', 'manual'].includes(order.status)) return { order, alreadyProcessed: true };

    if (payment.status === 'approved') {
      if (Math.abs(payment.amount - Number(order.amount)) > 0.01) {
        await order.update(
          { status: 'needs_review', mpPaymentId: payment.id, mpStatusDetail: 'monto_distinto' },
          { transaction: t }
        );
        return { order };
      }
      // Toma los números si siguen siendo de esta orden o quedaron libres (pago acreditado tarde)
      const tickets = await Ticket.findAll({
        where: {
          RaffleId: order.RaffleId,
          number: order.numbers,
          [Op.or]: [{ OrderId: order.id }, freeCondition()],
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (tickets.length !== order.numbers.length) {
        // Pagó, pero alguno de sus números se vendió a otro: liberar lo tomado y revisar a mano
        await Ticket.update(
          { status: 'available', reservedUntil: null, OrderId: null },
          { where: { OrderId: order.id, status: 'reserved' }, transaction: t }
        );
        await order.update(
          { status: 'needs_review', mpPaymentId: payment.id, mpStatusDetail: 'numeros_no_disponibles' },
          { transaction: t }
        );
        return { order };
      }
      await Ticket.update(
        { status: 'sold', reservedUntil: null, OrderId: order.id },
        { where: { id: tickets.map((x) => x.id) }, transaction: t }
      );
      await order.update(
        { status: 'approved', mpPaymentId: payment.id, mpStatusDetail: payment.statusDetail },
        { transaction: t }
      );
      return { order };
    }

    if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status)) {
      await order.update({ mpPaymentId: payment.id, mpStatusDetail: payment.statusDetail }, { transaction: t });
      // No liberamos ya: el comprador puede reintentar con otra tarjeta mientras dure la reserva.
    }
    return { order };
  });
}

// Corre cada minuto: vence órdenes impagas y libera sus números.
async function expireOrders() {
  const expired = await Order.findAll({
    where: { status: 'pending', expiresAt: { [Op.lt]: new Date() } },
    attributes: ['id'],
  });
  for (const o of expired) await releaseOrder(o.id, 'expired');
  return expired.length;
}

// Venta manual (efectivo/transferencia) cargada desde el panel.
async function manualSale({ raffleId, numbers, buyer }) {
  return sequelize.transaction(async (t) => {
    const raffle = await Raffle.findByPk(raffleId, { transaction: t });
    if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
    const unique = [...new Set(numbers.map(Number))];
    const tickets = await Ticket.findAll({
      where: { RaffleId: raffle.id, number: unique, ...freeCondition() },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (tickets.length !== unique.length) throw new HttpError(409, 'Algunos números no están disponibles');
    const order = await Order.create(
      {
        RaffleId: raffle.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email || '-',
        buyerPhone: buyer.phone || '-',
        buyerDni: buyer.dni || '-',
        numbers: unique.sort((a, b) => a - b),
        amount: computeTotal(raffle.pricePerNumber, raffle.promos, unique.length).total.toFixed(2),
        status: 'manual',
      },
      { transaction: t }
    );
    await Ticket.update(
      { status: 'sold', reservedUntil: null, OrderId: order.id },
      { where: { id: tickets.map((x) => x.id) }, transaction: t }
    );
    return order;
  });
}

module.exports = { validatePromos, HttpError, createRaffle, reserveAndCreateOrder, handlePayment, expireOrders, manualSale, releaseOrder };
