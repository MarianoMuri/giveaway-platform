const { Op } = require('sequelize');
const { sequelize, Raffle, Order, Course, Chance, FreeEntry, OrderEvent } = require('../db');
const { mp } = require('./mercadopago');
const { HttpError } = require('./errors');
const packs = require('./packs');
const numbers = require('./numbers');
const { confirmPackOrder } = require('./purchases');
const emails = require('./emails');
const sales = require('./sales');
const { cleanExcluded, cleanProvince } = require('./provinces');
const { cleanProfile } = require('./profile');

function cleanGoal(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'La meta de chances debe ser un entero mayor a 0');
  return n;
}

async function createRaffle(data) {
  const title = String(data.title || '').trim();
  const prize = String(data.prize || '').trim();
  if (!title || !prize) throw new HttpError(400, 'El título y el premio son obligatorios');
  return sequelize.transaction(async (transaction) => {
    const raffle = await Raffle.create(
      {
        title,
        prize,
        description: data.description,
        imageUrl: data.imageUrl,
        drawDate: data.drawDate || null,
        salesCloseAt: data.salesCloseAt && !Number.isNaN(new Date(data.salesCloseAt).getTime()) ? data.salesCloseAt : null,
        youtubeUrl: data.youtubeUrl,
        permitNumber: data.permitNumber,
        terms: data.terms,
        ...(data.excludedProvinces !== undefined && { excludedProvinces: cleanExcluded(data.excludedProvinces) }),
        chancesGoal: cleanGoal(data.chancesGoal) ?? null,
        status: 'draft',
      },
      { transaction }
    );
    await packs.seedDefaults(raffle, transaction); // escalera sugerida, editable desde el panel
    return raffle;
  });
}

// Procesa una notificación de pago. Idempotente: MP puede mandar la misma varias veces.
async function handlePayment(paymentId) {
  const payment = await mp.getPayment(paymentId);
  if (!payment.externalReference) return { ignored: true };

  const result = await sequelize.transaction(async (t) => {
    // FOR UPDATE: si llegan dos avisos del mismo pago a la vez, el segundo espera
    const order = await Order.findByPk(payment.externalReference, { lock: t.LOCK.UPDATE, transaction: t });
    if (!order || !order.chances) return { ignored: true };
    return confirmPackOrder(order, payment, t);
  });
  // Recién después del commit: el mail sale enseguida, sin demorar la respuesta a Mercado Pago.
  // Si falla, el proceso periódico lo reintenta.
  if (result.approved) result.email = emails.deliverSoon(result.order.id);
  return result;
}

// Venta manual (efectivo/transferencia) cargada desde el panel: los números se asignan en el acto.
async function manualSale({ raffleId, chances, courseId, amount, buyer }) {
  const n = Number(chances);
  if (!Number.isInteger(n) || n < 1 || n > 20000) throw new HttpError(400, 'Cantidad de chances inválida');
  const total = Number(amount);
  if (!(total >= 0)) throw new HttpError(400, 'Monto inválido');
  const b = buyer || {};
  const name = String(b.name || '').trim();
  const dni = String(b.dni || '').replace(/\D/g, '');
  if (name.length < 3) throw new HttpError(400, 'Falta el nombre del comprador');
  if (dni.length < 7 || dni.length > 8) throw new HttpError(400, 'El DNI no es válido');
  // Mismos datos obligatorios que en la compra online: hacen falta para contactar y verificar al ganador
  const email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').replace(/[^\d+]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Falta un email válido del comprador');
  if (phone.replace(/\D/g, '').length < 8) throw new HttpError(400, 'Falta un teléfono válido del comprador');
  if (!b.province) throw new HttpError(400, 'Falta la provincia del comprador');

  const order = await sequelize.transaction(async (transaction) => {
    const raffle = await Raffle.findByPk(raffleId, { transaction });
    if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
    if (raffle.status === 'drawn') throw new HttpError(409, 'El sorteo ya se realizó');
    const course = await Course.findByPk(Number(courseId) || 0, { transaction });
    if (!course) throw new HttpError(400, 'Elegí el curso');
    const order = await Order.create(
      {
        RaffleId: raffle.id,
        buyerName: name,
        buyerEmail: email,
        buyerPhone: phone,
        buyerDni: dni,
        buyerProvince: cleanProvince(b.province),
        locality: cleanProfile(b).locality,
        chances: n,
        amount: total.toFixed(2),
        CourseId: course.id,
        courseTitle: course.title,
        status: 'manual',
      },
      { transaction }
    );
    await numbers.assignNumbers(order, transaction);
    await OrderEvent.create({ OrderId: order.id, status: 'manual', detail: 'Venta cargada desde el panel' }, { transaction });
    await emails.enqueue(order, transaction); // solo si cargaron un email válido
    return order;
  });
  if (order.emailStatus === 'pending') order.emailDelivery = emails.deliverSoon(order.id);
  return order;
}

function assertClosedForDraw(raffle) {
  if (raffle.status === 'draft' || sales.isOpen(raffle)) {
    throw new HttpError(409, 'Cerrá la venta antes de cargar el ganador (podés poner una fecha de cierre o usar "Cerrar venta")');
  }
}

// Busca al dueño del número que salió en el vivo
async function drawWinner(raffleId, value, { redraw = false, expect = null } = {}) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const number = Number(value);
  if (!Number.isInteger(number)) throw new HttpError(400, 'Número inválido');
  // El sorteo se hace con la lista cerrada: con la venta abierta todavía pueden entrar números
  assertClosedForDraw(raffle);
  const chance = await Chance.findOne({ where: { RaffleId: raffle.id, number }, include: [Order, FreeEntry] });
  if (!chance) throw new HttpError(400, 'Ese número no fue asignado en este sorteo');
  if (chance.status === 'void') throw new HttpError(409, 'Ese número está anulado (compra reintegrada): sorteá de nuevo');
  if (raffle.status === 'drawn' && !redraw) throw new HttpError(409, 'Ya hay un ganador. Para repetir el sorteo indicá el motivo.');
  // Antes de dar a alguien como ganador se vuelve a preguntar a Mercado Pago por su pago: si fue
  // reintegrado o tiene contracargo y el aviso todavía no llegó, se anula acá y no puede ganar.
  const paid = chance.Order;
  if (paid && paid.status === 'approved' && paid.mpPaymentId) {
    let payment;
    try {
      payment = await mp.getPayment(paid.mpPaymentId);
    } catch (e) {
      throw new HttpError(503, 'No se pudo verificar el pago con Mercado Pago. Reintentá en un momento.');
    }
    if (['refunded', 'charged_back'].includes(payment.status)) {
      await sequelize.transaction(async (t) => {
        const fresh = await Order.findByPk(paid.id, { lock: t.LOCK.UPDATE, transaction: t });
        await confirmPackOrder(fresh, payment, t);
      });
      throw new HttpError(409, 'Ese número quedó anulado: el pago fue reintegrado o tiene contracargo. Sorteá de nuevo.');
    }
  }
  // Compare-and-swap: si otro administrador cargó un ganador mientras tanto, no se pisa en silencio
  const before = expect || raffle;
  const [changed] = await Raffle.update(
    { winnerNumber: number, status: 'drawn' },
    { where: { id: raffle.id, status: before.status, winnerNumber: before.winnerNumber ?? null } }
  );
  if (!changed) throw new HttpError(409, 'Otro administrador cargó el ganador al mismo tiempo. Actualizá la pantalla.');
  if (chance.FreeEntry) {
    // Ganó una participación gratuita: no hay teléfono, se contacta por email
    const f = chance.FreeEntry;
    return { number, winner: { name: f.name, phone: null, email: f.email, dni: f.dni, orderId: null, freeEntryId: f.id, source: 'free' } };
  }
  const o = chance.Order;
  return { number, winner: { name: o.buyerName, phone: o.buyerPhone, email: o.buyerEmail, dni: o.buyerDni, orderId: o.id, source: 'purchase' } };
}

async function raffleStats(raffleId) {
  const sold = ['approved', 'manual'];
  const [chancesSold, purchases, pending, review, revenue, freeEntries, reversed, raffle, emailsPending, emailsFailed] = await Promise.all([
    // "Vendidas" no incluye las gratuitas: la barra de progreso y la meta miden ventas
    Chance.count({ where: { RaffleId: raffleId, status: 'valid', OrderId: { [Op.ne]: null } } }),
    Order.count({ where: { RaffleId: raffleId, status: sold } }),
    Order.count({ where: { RaffleId: raffleId, status: 'pending' } }),
    Order.count({ where: { RaffleId: raffleId, status: 'needs_review' } }),
    Order.sum('amount', { where: { RaffleId: raffleId, status: sold } }),
    FreeEntry.count({ where: { RaffleId: raffleId, status: 'confirmed' } }),
    Order.count({ where: { RaffleId: raffleId, status: ['refunded', 'charged_back'] } }),
    Raffle.findByPk(raffleId),
    Order.count({ where: { RaffleId: raffleId, emailStatus: 'pending' } }),
    Order.count({ where: { RaffleId: raffleId, emailStatus: 'failed' } }),
  ]);
  // Si el número ganador ya sorteado quedó anulado (reintegro/contracargo posterior), el panel lo avisa
  let winnerVoided = false;
  if (raffle && raffle.winnerNumber != null) {
    const w = await Chance.findOne({ where: { RaffleId: raffleId, number: raffle.winnerNumber } });
    winnerVoided = !!w && w.status === 'void';
  }
  return { chancesSold, purchases, pending, review, revenue: Number(revenue || 0), freeEntries, reversed, winnerVoided, emailsPending, emailsFailed };
}

module.exports = { HttpError, createRaffle, handlePayment, manualSale, drawWinner, assertClosedForDraw, raffleStats, cleanGoal };
