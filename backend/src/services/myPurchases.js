const jwt = require('jsonwebtoken');
const { Op, fn, col, where } = require('sequelize');
const config = require('../config');
const { Order, Raffle, FreeEntry } = require('../db');
const courses = require('./courses');
const { captcha } = require('./captcha');
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

/**
 * Entrar con el DNI (sin contraseña ni mail).
 * El DNI no es un dato secreto, así que este acceso es de solo lectura y con lo mínimo:
 * sorteo, números y fecha, con el nombre abreviado. Para descargar el curso se pide además
 * el email de la compra (ver `downloadWithEmail`).
 * Siempre responde con la misma forma exista o no el DNI.
 */
const DNI_MAX_PER_WINDOW = 10;
const DNI_WINDOW_MS = 15 * 60 * 1000;
const dniHits = new Map(); // dni -> { count, since }
const resetDniThrottle = () => dniHits.clear();

const cleanDni = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 7 || d.length > 8) throw new HttpError(400, 'El DNI no es válido');
  return d;
};

// "Ana Gómez Pérez" -> "Ana G."
const shortName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0].toUpperCase()}.`;
};

function throttleDni(dni) {
  const now = Date.now();
  const hit = dniHits.get(dni);
  if (!hit || now - hit.since > DNI_WINDOW_MS) { dniHits.set(dni, { count: 1, since: now }); return; }
  hit.count += 1;
  if (hit.count > DNI_MAX_PER_WINDOW) throw new HttpError(429, 'Hiciste muchos intentos. Esperá unos minutos y probá de nuevo.');
}

const raffleInfo = (r) => r && { id: r.id, title: r.title, prize: r.prize, drawDate: r.drawDate, youtubeUrl: r.youtubeUrl };

async function listByDni({ dni: rawDni, captchaToken, ip }) {
  const dni = cleanDni(rawDni);
  await captcha.verify(captchaToken, ip);
  throttleDni(dni);

  const orders = await Order.findAll({
    where: { buyerDni: dni, status: PAID },
    include: { model: Raffle, attributes: ['id', 'title', 'prize', 'drawDate', 'youtubeUrl'] },
    order: [['createdAt', 'DESC']],
  });
  const free = await FreeEntry.findAll({
    where: { dni, status: 'confirmed' },
    include: { model: Raffle, attributes: ['id', 'title', 'prize', 'drawDate', 'youtubeUrl'] },
    order: [['createdAt', 'DESC']],
  });

  return {
    name: shortName(orders[0]?.buyerName || free[0]?.name),
    purchases: orders.map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      courseTitle: o.courseTitle,
      hasCourse: Boolean(o.CourseId),
      chances: o.chances,
      double: o.double,
      firstNumber: o.firstNumber,
      lastNumber: o.lastNumber,
      amount: o.amount,
      raffle: raffleInfo(o.Raffle),
    })),
    freeEntries: free.map((f) => ({ id: f.id, number: f.number, createdAt: f.createdAt, raffle: raffleInfo(f.Raffle) })),
  };
}

// Descarga: exige DNI + email de esa compra. El mensaje de error no dice cuál de los dos falló.
async function downloadWithEmail({ dni: rawDni, email: rawEmail, orderId, ip }) {
  const dni = cleanDni(rawDni);
  const email = normalize(rawEmail);
  throttleDni(dni);
  const order = await Order.findOne({
    where: { [Op.and]: [{ id: String(orderId || '') }, { buyerDni: dni }, { status: PAID }, where(fn('lower', col('Order.buyerEmail')), email)] },
    attributes: ['id', 'CourseId'],
  });
  if (!order || !order.CourseId) throw new HttpError(404, 'No encontramos una compra con esos datos. Revisá el email con el que compraste.');
  return { url: courses.downloadUrl(order.CourseId, 1) };
}

module.exports = { listByDni, downloadWithEmail, resetDniThrottle, requestLink, listPurchases, createToken, verifyToken, resetThrottle, LINK_MINUTES };
