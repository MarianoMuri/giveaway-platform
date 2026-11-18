const jwt = require('jsonwebtoken');
const { Op, fn, col, where } = require('sequelize');
const config = require('../config');
const { Order, Raffle } = require('../db');
const { mailer } = require('./mailer');
const { accessLink } = require('./emailTemplates');
const { HttpError } = require('./errors');

/**
 * "Mis compras" con link mágico (sin contraseñas):
 * el comprador pone su email, le llega un link que vence en pocos minutos y con él
 * ve todas sus compras y puede volver a bajar los cursos.
 *
 * Seguridad:
 * - La respuesta es siempre la misma exista o no el email: no se puede averiguar
 *   quién compró (anti-enumeración).
 * - Solo se manda el link si hay compras acreditadas para ese email.
 * - El link es un JWT con propósito propio ("my-purchases") que no sirve para nada más.
 * - Límite de un pedido por email por minuto, además del límite por IP de la ruta.
 */

const PURPOSE = 'my-purchases';
const LINK_MINUTES = 30;
const THROTTLE_MS = 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAID = ['approved', 'manual'];

// Con varias instancias del servidor habría que mover esto a la base o a Redis
const lastRequest = new Map();
const resetThrottle = () => lastRequest.clear();

const normalize = (email) => String(email || '').trim().toLowerCase();

// Compara sin distinguir mayúsculas: "Ana@Mail.com" y "ana@mail.com" son la misma persona
const paidOrders = (email) =>
  Order.findAll({
    where: { [Op.and]: [{ status: PAID }, where(fn('lower', col('Order.buyerEmail')), email)] },
    include: { model: Raffle, attributes: ['id', 'title', 'prize', 'drawDate', 'youtubeUrl'] },
    order: [['createdAt', 'DESC']],
  });

function createToken(email) {
  return jwt.sign({ purpose: PURPOSE, email }, config.jwtSecret, { expiresIn: `${LINK_MINUTES}m` });
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(String(token || ''), config.jwtSecret);
    if (payload.purpose !== PURPOSE || !payload.email) throw new Error('propósito inválido');
    return payload.email;
  } catch {
    throw new HttpError(401, 'El link venció o no es válido. Pedí uno nuevo.');
  }
}

// Pide el link. Nunca revela si el email tiene compras.
async function requestLink(rawEmail) {
  const email = normalize(rawEmail);
  if (!EMAIL.test(email)) throw new HttpError(400, 'Ingresá un email válido');

  const now = Date.now();
  if (now - (lastRequest.get(email) || 0) < THROTTLE_MS) return { sent: false, reason: 'throttled' };
  lastRequest.set(email, now);

  const orders = await paidOrders(email);
  if (!orders.length) return { sent: false, reason: 'no-orders' };

  const url = `${config.frontendUrl}/mis-compras?token=${createToken(email)}`;
  await mailer.send({ to: email, ...accessLink({ brand: config.brand, url, minutes: LINK_MINUTES, count: orders.length }) });
  return { sent: true };
}

// Compras acreditadas del dueño del link
async function listPurchases(token) {
  const email = verifyToken(token);
  const orders = await paidOrders(email);
  return orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    courseTitle: o.courseTitle,
    hasCourse: Boolean(o.CourseId),
    chances: o.chances,
    double: o.double,
    firstNumber: o.firstNumber,
    lastNumber: o.lastNumber,
    amount: o.amount,
    raffle: o.Raffle && { id: o.Raffle.id, title: o.Raffle.title, prize: o.Raffle.prize, drawDate: o.Raffle.drawDate, youtubeUrl: o.Raffle.youtubeUrl },
  }));
}

module.exports = { requestLink, listPurchases, createToken, verifyToken, resetThrottle, LINK_MINUTES };
