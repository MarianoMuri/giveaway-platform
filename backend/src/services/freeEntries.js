const crypto = require('crypto');
const { Op } = require('sequelize');
const config = require('../config');
const { sequelize, Raffle, Chance, FreeEntry } = require('../db');
const { mailer } = require('./mailer');
const { captcha } = require('./captcha');
const { freeEntryConfirm, freeEntryNumber } = require('./emailTemplates');
const numbers = require('./numbers');
const { HttpError } = require('./errors');
const sales = require('./sales');
const provinces = require('./provinces');

/**
 * Participación gratuita ("sin obligación de compra").
 *
 * - 1 número por DNI y por sorteo (índice único en la base).
 * - El número se asigna recién cuando la persona confirma su email con un link de un solo uso.
 *   Hasta entonces no se reserva nada: nadie puede "ocupar" el DNI de otro.
 * - Captcha, límite por IP y por dispositivo. Del IP y del dispositivo solo se guarda un hash.
 *
 * Límite conocido: el DNI no se puede verificar en línea. Por eso el ganador debe acreditar
 * su identidad al recibir el premio, y el panel permite anular una participación.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DEVICE = /^[\w-]{16,64}$/;
const sha = (v) => crypto.createHash('sha256').update(`${config.jwtSecret}:${v}`).digest('hex');
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function clean({ name, dni, email, province }) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  const d = String(dni || '').replace(/\D/g, '');
  const e = String(email || '').trim().toLowerCase();
  if (n.length < 3 || n.length > 100) throw new HttpError(400, 'Ingresá tu nombre completo');
  if (d.length < 7 || d.length > 8) throw new HttpError(400, 'El DNI no es válido');
  if (!EMAIL.test(e)) throw new HttpError(400, 'Ingresá un email válido');
  return { name: n, dni: d, email: e, province: provinces.cleanProvince(province) };
}

// Pide participar: valida, guarda la participación sin confirmar y manda el link por email
async function request({ raffleId, name, dni, email, province, captchaToken, deviceId, ip }) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle || raffle.status === 'draft') throw new HttpError(404, 'Sorteo no encontrado');
  if (!raffle.freeEntryEnabled) throw new HttpError(409, 'Este sorteo no tiene participación gratuita');
  sales.assertOpen(raffle, 'La participación en este sorteo está cerrada');

  const data = clean({ name, dni, email, province });
  provinces.assertAvailable(raffle, data.province);
  if (!DEVICE.test(String(deviceId || ''))) throw new HttpError(400, 'No pudimos identificar tu dispositivo. Recargá la página.');
  await captcha.verify(captchaToken, ip);

  const existing = await FreeEntry.findOne({ where: { RaffleId: raffle.id, dni: data.dni } });
  if (existing && existing.status !== 'unconfirmed') throw new HttpError(409, 'Ese DNI ya está participando en este sorteo');

  // Límites contra abuso. La participación propia pendiente no cuenta: se reemplaza.
  const notSelf = existing ? { id: { [Op.ne]: existing.id } } : {};
  const ipHash = sha(`ip:${ip}`);
  const deviceHash = sha(`dev:${deviceId}`);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byDevice, byIp] = await Promise.all([
    FreeEntry.count({ where: { RaffleId: raffle.id, deviceHash, status: { [Op.ne]: 'void' }, ...notSelf } }),
    FreeEntry.count({ where: { RaffleId: raffle.id, ipHash, createdAt: { [Op.gte]: dayAgo }, ...notSelf } }),
  ]);
  if (byDevice >= 1) throw new HttpError(429, 'Desde este dispositivo ya se registró una participación gratuita');
  if (byIp >= config.freeEntries.perIpPerDay) throw new HttpError(429, 'Se alcanzó el límite de participaciones desde esta conexión. Probá más tarde.');

  const token = crypto.randomBytes(32).toString('hex');
  const fields = {
    ...data, status: 'unconfirmed', ipHash, deviceHash,
    tokenHash: tokenHash(token),
    tokenExpiresAt: new Date(Date.now() + config.freeEntries.confirmHours * 3600 * 1000),
  };
  // La última solicitud pisa a la anterior sin confirmar: el link viejo deja de servir
  if (existing) await existing.update(fields);
  else {
    try {
      await FreeEntry.create({ RaffleId: raffle.id, ...fields });
    } catch (e) {
      // Dos pedidos simultáneos con el mismo DNI: el índice único deja pasar uno solo
      if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'Ese DNI ya está participando en este sorteo');
      throw e;
    }
  }

  const url = `${config.frontendUrl}/participar-gratis/confirmar?token=${token}`;
  try {
    await mailer.send({ to: data.email, ...freeEntryConfirm({ brand: config.brand, url, hours: config.freeEntries.confirmHours, raffle }) });
  } catch (e) {
    console.error('[gratis] no se pudo enviar el email de confirmación:', e.message);
    throw new HttpError(503, 'No pudimos enviarte el email. Probá de nuevo en unos minutos.');
  }
  return { ok: true };
}

// Confirma el email y asigna el número. Idempotente: abrir el link dos veces devuelve el mismo número.
async function confirm(token) {
  if (!token) throw new HttpError(400, 'El link no es válido');
  const hash = tokenHash(token);
  const found = await FreeEntry.findOne({ where: { tokenHash: hash } });
  if (!found) throw new HttpError(404, 'El link no es válido o ya fue reemplazado por uno más nuevo');

  const result = await sequelize.transaction(async (t) => {
    const entry = await FreeEntry.findByPk(found.id, { lock: t.LOCK.UPDATE, transaction: t });
    if (entry.status === 'void') throw new HttpError(409, 'Esta participación fue anulada');
    if (entry.status === 'confirmed') return { entry, already: true };
    if (entry.tokenExpiresAt < new Date()) throw new HttpError(410, 'El link venció. Volvé a pedir tu participación.');
    const raffle = await Raffle.findByPk(entry.RaffleId, { transaction: t });
    sales.assertOpen(raffle, 'La participación en este sorteo ya está cerrada');
    const { first } = await numbers.reserveBlock(raffle.id, 1, t);
    await Chance.create({ number: first, RaffleId: raffle.id, FreeEntryId: entry.id }, { transaction: t });
    await entry.update({ status: 'confirmed', number: first, confirmedAt: new Date() }, { transaction: t });
    return { entry, raffle, already: false };
  });

  const raffle = result.raffle || (await Raffle.findByPk(result.entry.RaffleId));
  if (!result.already) {
    // Aviso con el número: si falla no importa, la persona ya lo ve en pantalla
    mailer.send({ to: result.entry.email, ...freeEntryNumber({ brand: config.brand, entry: result.entry, raffle }) })
      .catch((e) => console.error('[gratis] no se pudo enviar el email con el número:', e.message));
  }
  return {
    number: result.entry.number,
    already: result.already,
    name: result.entry.name,
    raffle: { id: raffle.id, title: raffle.title, prize: raffle.prize, drawDate: raffle.drawDate, youtubeUrl: raffle.youtubeUrl },
  };
}

const list = (raffleId) =>
  FreeEntry.findAll({
    where: { RaffleId: raffleId },
    attributes: ['id', 'name', 'dni', 'email', 'status', 'number', 'confirmedAt', 'createdAt'],
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

// Anula una participación (DNI falso, duplicado, etc.). El número no se reutiliza.
async function voidEntry(id) {
  return sequelize.transaction(async (t) => {
    const entry = await FreeEntry.findByPk(id, { lock: t.LOCK.UPDATE, transaction: t });
    if (!entry) throw new HttpError(404, 'Participación no encontrada');
    await Chance.update({ status: 'void' }, { where: { FreeEntryId: entry.id, status: 'valid' }, transaction: t });
    await entry.update({ status: 'void', tokenHash: null }, { transaction: t });
    return entry;
  });
}

module.exports = { request, confirm, list, voidEntry };
