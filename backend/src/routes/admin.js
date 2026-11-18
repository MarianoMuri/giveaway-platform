const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const requireAdmin = require('../middleware/auth');
const { Raffle, Order, Chance, OrderEvent, FreeEntry } = require('../db');
const { createRaffle, manualSale, raffleStats, cleanGoal, HttpError } = require('../services/orders');
const packs = require('../services/packs');
const emails = require('../services/emails');
const readiness = require('../services/readiness');
const freeEntries = require('../services/freeEntries');
const { search } = require('../services/search');
const audit = require('../services/audit');
const mpHealth = require('../services/mpHealth');
const draw = require('../services/draw');
const { AuditLog } = require('../db');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const valid =
    email === config.admin.email &&
    config.admin.passwordHash &&
    (await bcrypt.compare(String(password || ''), config.admin.passwordHash));
  if (!valid) {
    await audit.record({ actor: String(email || '').slice(0, 100) || 'desconocido', action: 'login.failed', ip: req.ip });
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  await audit.record({ actor: email, action: 'login.ok', ip: req.ip });
  res.json({ token: jwt.sign({ email }, config.jwtSecret, { expiresIn: '12h' }) });
});

router.use(requireAdmin);
router.use(audit.trail);

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.get('/raffles', wrap(async (req, res) => {
  res.json(await Raffle.findAll({ order: [['createdAt', 'DESC']] }));
}));

router.post('/raffles', wrap(async (req, res) => {
  res.status(201).json(await createRaffle(req.body || {}));
}));

// Packs de chances + oferta "Duplicá" del sorteo
// preview: cómo lo ve el comprador, calculado por el mismo código que cobra
const adminPacksView = (config) => ({ packs: config.packs, offer: config.offer, preview: packs.publicView(config).packs });

router.get('/raffles/:id/packs', wrap(async (req, res) => {
  res.json(adminPacksView(await packs.getConfig(req.params.id)));
}));

router.put('/raffles/:id/packs', wrap(async (req, res) => {
  res.json(adminPacksView(await packs.saveConfig(req.params.id, req.body)));
}));

router.patch('/raffles/:id', wrap(async (req, res) => {
  const raffle = await Raffle.findByPk(req.params.id);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const allowed = ['title', 'description', 'prize', 'imageUrl', 'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'chancesGoal', 'freeEntryEnabled', 'salesCloseAt'];
  const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if ('chancesGoal' in changes) changes.chancesGoal = cleanGoal(changes.chancesGoal);
  if ('salesCloseAt' in changes) {
    if (changes.salesCloseAt === '' || changes.salesCloseAt === null) changes.salesCloseAt = null;
    else if (Number.isNaN(new Date(changes.salesCloseAt).getTime())) throw new HttpError(400, 'La fecha de cierre no es válida');
  }
  if (changes.status && !['draft', 'active', 'closed'].includes(changes.status)) {
    throw new HttpError(400, 'Estado inválido'); // "drawn" solo se pone al cargar el ganador
  }
  if (changes.status && raffle.status === 'drawn') throw new HttpError(409, 'El sorteo ya se realizó: no se puede cambiar el estado de la venta');
  res.json(await raffle.update(changes));
}));

// Cargar el número ganador del sorteo en vivo
router.post('/raffles/:id/winner', wrap(async (req, res) => {
  res.locals.audited = true; // lo registra el servicio, con el detalle del sorteo
  res.json(await draw.loadManual(req.params.id, req.body?.number, { ...audit.who(req), reason: req.body?.reason }));
}));

// Sorteo en vivo: el servidor elige el ganador al azar entre los números válidos
router.post('/raffles/:id/draw', wrap(async (req, res) => {
  res.locals.audited = true;
  res.json(await draw.drawRandom(req.params.id, { ...audit.who(req), reason: req.body?.reason }));
}));

router.get('/raffles/:id/draws', wrap(async (req, res) => {
  res.json(await draw.listDraws(req.params.id));
}));

// Vuelve a poner en cola todos los emails fallidos del sorteo (se envían de a poco, al ritmo del proveedor)
router.post('/raffles/:id/emails/retry-failed', wrap(async (req, res) => {
  const requeued = await emails.retryFailed(Number(req.params.id));
  await audit.record({ ...audit.who(req), action: 'emails.retry_failed', raffleId: Number(req.params.id), detail: `${requeued} emails` });
  res.locals.audited = true;
  res.json({ requeued });
}));

// Estado de la conexión con Mercado Pago (lo mantiene el monitor). POST fuerza un chequeo ahora.
router.get('/mp-status', (req, res) => res.json(mpHealth.getStatus()));
router.post('/mp-status/check', wrap(async (req, res) => res.json(await mpHealth.check())));

// Registro de auditoría (solo lectura): lo más reciente primero
router.get('/audit', wrap(async (req, res) => {
  await audit.flush(); // incluye las acciones recién hechas, cuya escritura puede estar terminando
  const where = {};
  if (req.query.raffleId) where.RaffleId = Number(req.query.raffleId) || -1;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(await AuditLog.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit }));
}));

// Control previo al sorteo: carga los pagos que faltaban (consulta a Mercado Pago) y resume el estado
router.post('/raffles/:id/readiness', wrap(async (req, res) => {
  res.json(await readiness.check(req.params.id));
}));

router.get('/raffles/:id/stats', wrap(async (req, res) => {
  res.json(await raffleStats(req.params.id));
}));

// Participaciones gratuitas del sorteo y su anulación
router.get('/raffles/:id/free-entries', wrap(async (req, res) => {
  res.json(await freeEntries.list(req.params.id));
}));

router.post('/free-entries/:id/void', wrap(async (req, res) => {
  const entry = await freeEntries.voidEntry(req.params.id);
  res.json({ id: entry.id, status: entry.status });
}));

// Buscador: por número, DNI, email o nombre
router.get('/raffles/:id/search', wrap(async (req, res) => {
  res.json(await search(req.params.id, req.query.q));
}));

router.get('/orders', wrap(async (req, res) => {
  const where = {};
  if (req.query.raffleId) where.RaffleId = req.query.raffleId;
  if (req.query.status) where.status = req.query.status;
  res.json(await Order.findAll({ where, order: [['createdAt', 'DESC']], limit: 500 }));
}));

// Historial de estados de una compra (aprobada, reintegrada, contracargo...)
router.get('/orders/:id/history', wrap(async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) throw new HttpError(404, 'Compra no encontrada');
  const events = await OrderEvent.findAll({ where: { OrderId: order.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  const voided = await Chance.count({ where: { OrderId: order.id, status: 'void' } });
  res.json({ status: order.status, voidedAt: order.voidedAt, voidReason: order.voidReason, voidedNumbers: voided, events });
}));

router.post('/orders/manual', wrap(async (req, res) => {
  const order = await manualSale(req.body || {});
  res.status(201).json(order);
}));

// Reenviar el email de confirmación (opcional: a un email corregido)
router.post('/orders/:id/resend-email', wrap(async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) throw new HttpError(404, 'Compra no encontrada');
  if (!['approved', 'manual'].includes(order.status)) throw new HttpError(409, 'Solo se reenvía el email de compras acreditadas');
  const email = req.body?.email;
  if (email !== undefined && !emails.hasEmail({ buyerEmail: email })) throw new HttpError(400, 'El email no es válido');
  const result = await emails.resend(order, email);
  await order.reload();
  res.json({ result, emailStatus: order.emailStatus, emailLastError: order.emailLastError, buyerEmail: order.buyerEmail });
}));

// Exportación CSV de compradores (se abre en Excel)
// Listado completo del sorteo: compras (incluidas las anuladas, con su estado) y participaciones gratuitas
router.get('/raffles/:id/export.csv', wrap(async (req, res) => {
  const [orders, frees] = await Promise.all([
    Order.findAll({
      where: { RaffleId: req.params.id, status: ['approved', 'manual', 'needs_review', 'refunded', 'charged_back'] },
      order: [['createdAt', 'ASC']],
    }),
    FreeEntry.findAll({ where: { RaffleId: req.params.id, status: ['confirmed', 'void'] }, order: [['createdAt', 'ASC']] }),
  ]);
  // Los nombres y emails los escribe el público: una celda que empiece con = + @ se abriría como fórmula en Excel
  const safe = (v) => (/^[=+@\t\r]|^-./.test(String(v ?? '')) ? `'${v}` : v);
  const esc = (v) => `"${String(safe(v) ?? '').replace(/"/g, '""')}"`;
  const iso = (d) => (d ? d.toISOString() : '');
  const lines = [['Fecha', 'Nombre', 'DNI', 'Teléfono', 'Email', 'Curso', 'Chances', 'Desde', 'Hasta', 'Monto', 'Estado', 'Pago MP', 'Anulada el', 'Motivo'].join(';')];
  for (const o of orders) {
    lines.push([iso(o.createdAt), o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail, o.courseTitle,
      o.chances, o.firstNumber, o.lastNumber, Number(o.amount).toFixed(2), o.status, o.mpPaymentId, iso(o.voidedAt), o.voidReason].map(esc).join(';'));
  }
  for (const f of frees) {
    lines.push([iso(f.createdAt), f.name, f.dni, '', f.email, 'Participación gratuita', 1, f.number, f.number, '0.00',
      f.status === 'void' ? 'gratuita_anulada' : 'gratuita', '', '', ''].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="sorteo-${req.params.id}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

module.exports = router;
