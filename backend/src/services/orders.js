const { sequelize, Raffle, Order, Course, Chance } = require('../db');
const { mp } = require('./mercadopago');
const { HttpError } = require('./errors');
const packs = require('./packs');
const numbers = require('./numbers');
const { confirmPackOrder } = require('./purchases');

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
        youtubeUrl: data.youtubeUrl,
        permitNumber: data.permitNumber,
        terms: data.terms,
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

  return sequelize.transaction(async (t) => {
    // FOR UPDATE: si llegan dos avisos del mismo pago a la vez, el segundo espera
    const order = await Order.findByPk(payment.externalReference, { lock: t.LOCK.UPDATE, transaction: t });
    if (!order || !order.chances) return { ignored: true };
    return confirmPackOrder(order, payment, t);
  });
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

  return sequelize.transaction(async (transaction) => {
    const raffle = await Raffle.findByPk(raffleId, { transaction });
    if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
    if (raffle.status === 'drawn') throw new HttpError(409, 'El sorteo ya se realizó');
    const course = await Course.findByPk(Number(courseId) || 0, { transaction });
    if (!course) throw new HttpError(400, 'Elegí el curso');
    const order = await Order.create(
      {
        RaffleId: raffle.id,
        buyerName: name,
        buyerEmail: String(b.email || '-').trim().toLowerCase() || '-',
        buyerPhone: String(b.phone || '-').trim() || '-',
        buyerDni: dni,
        chances: n,
        amount: total.toFixed(2),
        CourseId: course.id,
        courseTitle: course.title,
        status: 'manual',
      },
      { transaction }
    );
    await numbers.assignNumbers(order, transaction);
    return order;
  });
}

// Busca al dueño del número que salió en el vivo
async function drawWinner(raffleId, value) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const number = Number(value);
  if (!Number.isInteger(number)) throw new HttpError(400, 'Número inválido');
  const chance = await Chance.findOne({ where: { RaffleId: raffle.id, number }, include: Order });
  if (!chance) throw new HttpError(400, 'Ese número no fue asignado en este sorteo');
  if (chance.status === 'void') throw new HttpError(409, 'Ese número está anulado (compra reintegrada): sorteá de nuevo');
  await raffle.update({ winnerNumber: number, status: 'drawn' });
  const o = chance.Order;
  return { number, winner: { name: o.buyerName, phone: o.buyerPhone, email: o.buyerEmail, dni: o.buyerDni, orderId: o.id } };
}

async function raffleStats(raffleId) {
  const sold = ['approved', 'manual'];
  const [chancesSold, purchases, pending, review, revenue] = await Promise.all([
    Chance.count({ where: { RaffleId: raffleId, status: 'valid' } }),
    Order.count({ where: { RaffleId: raffleId, status: sold } }),
    Order.count({ where: { RaffleId: raffleId, status: 'pending' } }),
    Order.count({ where: { RaffleId: raffleId, status: 'needs_review' } }),
    Order.sum('amount', { where: { RaffleId: raffleId, status: sold } }),
  ]);
  return { chancesSold, purchases, pending, review, revenue: Number(revenue || 0) };
}

module.exports = { HttpError, createRaffle, handlePayment, manualSale, drawWinner, raffleStats, cleanGoal };
