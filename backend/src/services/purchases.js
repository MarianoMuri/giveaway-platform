const { sequelize, Raffle, Order, Course, OrderEvent } = require('../db');
const { mp } = require('./mercadopago');
const { HttpError } = require('./errors');
const packs = require('./packs');
const numbers = require('./numbers');
const emails = require('./emails');
const provinces = require('./provinces');
const { cleanProfile } = require('./profile');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanBuyer(buyer) {
  const b = buyer || {};
  const out = {
    name: String(b.name || '').trim().replace(/\s+/g, ' '),
    email: String(b.email || '').trim().toLowerCase(),
    phone: String(b.phone || '').replace(/[^\d+]/g, ''),
    dni: String(b.dni || '').replace(/\D/g, ''),
    province: provinces.cleanProvince(b.province),
    ...cleanProfile(b),
  };
  if (out.name.length < 3) throw new HttpError(400, 'Ingresá tu nombre y apellido');
  if (!EMAIL.test(out.email)) throw new HttpError(400, 'El email no es válido');
  if (out.phone.replace(/\D/g, '').length < 8) throw new HttpError(400, 'El teléfono no es válido');
  if (out.dni.length < 7 || out.dni.length > 8) throw new HttpError(400, 'El DNI no es válido');
  return out;
}

/**
 * Crea una compra pendiente (curso + pack) y la preferencia de pago.
 * No asigna números: eso pasa recién cuando Mercado Pago confirma el pago.
 * Por eso no hay reserva ni vencimiento: si el comprador no paga, la orden
 * queda pendiente y no le saca nada a nadie.
 */
async function createPurchase({ raffleId, packId, double, courseId, buyer, code }) {
  const b = cleanBuyer(buyer);
  const course = await Course.findOne({ where: { id: Number(courseId) || 0, active: true } });
  if (!course) throw new HttpError(400, 'Elegí un curso');
  const quote = await packs.quoteForRaffle(raffleId, { packId, double, code }); // valida sorteo activo, pack y código de promo
  const raffle = await Raffle.findByPk(raffleId);
  provinces.assertAvailable(raffle, b.province); // antes de crear nada: una provincia excluida no deja rastros

  const order = await Order.create({
    RaffleId: raffle.id,
    buyerName: b.name,
    buyerEmail: b.email,
    buyerPhone: b.phone,
    buyerDni: b.dni,
    buyerProvince: b.province,
    locality: b.locality,
    PackId: quote.packId,
    double: quote.double,
    chances: quote.chances, // ya incluye las chances de regalo de la promo
    amount: quote.total.toFixed(2),
    PromoId: quote.promo?.id || null,
    PromoIds: quote.applied?.length ? quote.applied.map((x) => x.id).join(',') : null,
    promoName: quote.promo?.name ? quote.promo.name.slice(0, 80) : null,
    promoCode: quote.promo?.code || null,
    discount: (quote.discount || 0).toFixed(2),
    bonusChances: quote.bonusChances || 0,
    CourseId: course.id,
    courseTitle: course.title,
  });

  try {
    const checkout = await mp.createCheckout({
      order,
      raffle,
      title: `Curso "${course.title}" + ${quote.chances} chances - ${raffle.title}`,
    });
    await order.update({ mpPreferenceId: checkout.id });
    return { orderId: order.id, checkoutUrl: checkout.initPoint, total: quote.total, chances: quote.chances };
  } catch (err) {
    await order.update({ status: 'rejected', mpStatusDetail: 'error_checkout' });
    throw new HttpError(502, 'No se pudo iniciar el pago con Mercado Pago', { detail: err.message });
  }
}

/**
 * Confirma una compra por pack a partir del pago informado por Mercado Pago.
 * Se ejecuta con la orden bloqueada (FOR UPDATE) dentro de la transacción del
 * webhook, así que es idempotente: si el aviso se repite, la orden ya está
 * aprobada y no se asignan números de nuevo.
 */
const REVERSALS = {
  refunded: 'Pago reintegrado',
  charged_back: 'Contracargo: el comprador desconoce el pago',
};

function addEvent(order, status, detail, mpPaymentId, transaction) {
  return OrderEvent.create({ OrderId: order.id, status, detail: detail || null, mpPaymentId: mpPaymentId || null }, { transaction });
}

// Pago devuelto o desconocido: la compra y sus números quedan anulados (con fecha y motivo).
// Solo cuenta si el aviso es del pago que acreditó la compra, no de un intento anterior.
async function reverseOrder(order, payment, transaction) {
  const reason = REVERSALS[payment.status];
  const voided = await numbers.voidNumbers(order.id, transaction, reason);
  await order.update(
    { status: payment.status, voidedAt: new Date(), voidReason: reason, mpStatusDetail: payment.statusDetail || payment.status },
    { transaction }
  );
  await addEvent(order, payment.status, reason, payment.id, transaction);
  return { order, reversed: true, voided };
}

async function confirmPackOrder(order, payment, transaction) {
  if (REVERSALS[payment.status]) {
    const same = order.mpPaymentId && order.mpPaymentId === payment.id;
    if (same && ['approved', 'needs_review'].includes(order.status)) return reverseOrder(order, payment, transaction);
    return { order, alreadyProcessed: true };
  }
  if (order.status !== 'pending') return { order, alreadyProcessed: true };

  if (payment.status === 'approved') {
    if (Math.abs(payment.amount - Number(order.amount)) > 0.01) {
      await order.update({ status: 'needs_review', mpPaymentId: payment.id, mpStatusDetail: 'monto_distinto' }, { transaction });
      await addEvent(order, 'needs_review', 'El monto pagado no coincide con el de la compra', payment.id, transaction);
      return { order };
    }
    const range = await numbers.assignNumbers(order, transaction);
    await order.update({ status: 'approved', mpPaymentId: payment.id, mpStatusDetail: payment.statusDetail }, { transaction });
    await addEvent(order, 'approved', 'Pago acreditado', payment.id, transaction);
    await emails.enqueue(order, transaction); // outbox: el mail queda pendiente en la misma transacción
    return { order, ...range, approved: true };
  }

  // Rechazado / cancelado: se registra, pero la orden queda pendiente para que
  // el comprador pueda reintentar con otro medio desde el mismo checkout.
  await order.update({ mpPaymentId: payment.id, mpStatusDetail: payment.statusDetail }, { transaction });
  return { order };
}

module.exports = { createPurchase, confirmPackOrder, cleanBuyer };
