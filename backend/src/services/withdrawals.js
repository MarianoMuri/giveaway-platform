const { Op, fn, col, where } = require('sequelize');
const config = require('../config');
const { sequelize, Order, Raffle, Withdrawal } = require('../db');
const { mp } = require('./mercadopago');
const { mailer } = require('./mailer');
const { withdrawalMail } = require('./emailTemplates');
const { reverseOrder } = require('./purchases');
const { HttpError } = require('./errors');

// Arrepentimiento (Res. 424/2020). El comprador pide con DNI + email; el administrador decide.
// Devolver el dinero es una acción manual del administrador: nunca ocurre solo con el pedido.
const PAID = ['approved', 'manual', 'needs_review'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const codeOf = (w) => `ARR-${String(w.id).padStart(5, '0')}`;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

// Los emails no frenan la acción: si fallan queda el aviso en el log y la solicitud igual está guardada
async function notify(to, data) {
  try {
    await mailer.send({ to, ...withdrawalMail({ brand: config.brand, ...data }) });
  } catch (e) {
    console.error('[arrepentimiento] no se pudo enviar el email:', e.message);
  }
}

/**
 * Pedido del comprador. Responde siempre lo mismo (existan o no datos que coincidan), así nadie
 * puede averiguar quién compró. Solo si coinciden se manda la constancia al email de la compra.
 */
async function request({ dni: rawDni, email: rawEmail }) {
  const dni = String(rawDni || '').replace(/\D/g, '');
  const email = normalizeEmail(rawEmail);
  if (dni.length < 7 || dni.length > 8) throw new HttpError(400, 'El DNI no es válido');
  if (!EMAIL.test(email)) throw new HttpError(400, 'El email no es válido');

  const orders = await Order.findAll({
    where: { [Op.and]: [{ buyerDni: dni }, { status: PAID }, where(fn('lower', col('Order.buyerEmail')), email)] },
  });
  const created = [];
  if (orders.length === 0) {
    // Se guarda igual (con datos mal escritos) para que el administrador pueda escribirle; sin duplicar
    const dup = await Withdrawal.findOne({ where: { dni, email, OrderId: null, status: 'pending' } });
    if (!dup) await Withdrawal.create({ dni, email });
  }
  for (const order of orders) {
    const dup = await Withdrawal.findOne({ where: { OrderId: order.id, status: 'pending' } });
    if (dup) continue;
    created.push({ order, withdrawal: await Withdrawal.create({ dni, email, OrderId: order.id }) });
  }
  for (const { order, withdrawal } of created) {
    await notify(order.buyerEmail, { kind: 'received', code: codeOf(withdrawal), courseTitle: order.courseTitle || 'curso digital' });
    if (config.admin.email.includes('@')) {
      await notify(config.admin.email, { kind: 'admin', code: codeOf(withdrawal), courseTitle: order.courseTitle || 'curso digital', panelUrl: `${config.frontendUrl}/admin/arrepentimientos` });
    }
  }
  return { ok: true };
}

async function list(status) {
  const rows = await Withdrawal.findAll({
    where: status ? { status } : {},
    include: { model: Order, include: { model: Raffle, attributes: ['id', 'title', 'status', 'drawDate', 'winnerNumber'] } },
    order: [['createdAt', 'DESC']],
    limit: 300,
  });
  return rows.map((w) => ({
    id: w.id,
    code: codeOf(w),
    status: w.status,
    note: w.note,
    createdAt: w.createdAt,
    resolvedAt: w.resolvedAt,
    dni: w.dni,
    email: w.email,
    order: w.Order && {
      id: w.Order.id,
      status: w.Order.status,
      buyerName: w.Order.buyerName,
      courseTitle: w.Order.courseTitle,
      chances: w.Order.chances,
      firstNumber: w.Order.firstNumber,
      lastNumber: w.Order.lastNumber,
      amount: w.Order.amount,
      paidWithMp: Boolean(w.Order.mpPaymentId),
      raffle: w.Order.Raffle && { id: w.Order.Raffle.id, title: w.Order.Raffle.title, status: w.Order.Raffle.status, drawDate: w.Order.Raffle.drawDate, winnerNumber: w.Order.Raffle.winnerNumber },
    },
  }));
}

async function pendingOrFail(id) {
  const w = await Withdrawal.findByPk(id);
  if (!w) throw new HttpError(404, 'Solicitud no encontrada');
  if (w.status !== 'pending') throw new HttpError(409, 'Esa solicitud ya fue resuelta');
  return w;
}

/**
 * Aprueba: pide la devolución a Mercado Pago (si la compra se pagó por ahí), anula los números
 * y avisa al comprador. Si Mercado Pago falla, no se anula nada y la solicitud sigue pendiente.
 */
async function approve(id) {
  const w = await pendingOrFail(id);
  if (!w.OrderId) throw new HttpError(409, 'Esta solicitud no tiene una compra asociada: no hay nada que devolver. Rechazala con una nota o escribile al comprador.');
  const order = await Order.findByPk(w.OrderId);
  if (!order || !PAID.includes(order.status)) throw new HttpError(409, 'Esa compra ya no está acreditada (puede estar ya reintegrada)');

  if (order.mpPaymentId) {
    try {
      await mp.refund(order.mpPaymentId, `withdrawal-${w.id}`);
    } catch (e) {
      throw new HttpError(502, `Mercado Pago no pudo hacer la devolución: ${e.message}. No se cambió nada, probá de nuevo.`);
    }
  }
  await sequelize.transaction(async (t) => {
    const fresh = await Order.findByPk(order.id, { lock: t.LOCK.UPDATE, transaction: t });
    if (PAID.includes(fresh.status)) {
      // El motivo queda guardado en la compra. Sin mpPaymentId (venta manual) se anula igual.
      await reverseOrder(fresh, { id: fresh.mpPaymentId || null, status: 'refunded' }, t, 'Arrepentimiento aceptado');
    }
    await w.update({ status: 'approved', resolvedAt: new Date() }, { transaction: t });
  });
  await notify(order.buyerEmail, { kind: 'approved', code: codeOf(w), courseTitle: order.courseTitle || 'curso digital' });
  return { ok: true, manualRefund: !order.mpPaymentId };
}

async function reject(id, rawNote) {
  const note = String(rawNote || '').trim().slice(0, 500);
  if (note.length < 3) throw new HttpError(400, 'Escribí el motivo del rechazo');
  const w = await pendingOrFail(id);
  await w.update({ status: 'rejected', note, resolvedAt: new Date() });
  const order = w.OrderId ? await Order.findByPk(w.OrderId) : null;
  await notify(order ? order.buyerEmail : w.email, { kind: 'rejected', code: codeOf(w), courseTitle: order?.courseTitle || '', note });
  return { ok: true };
}

module.exports = { request, list, approve, reject, codeOf };
