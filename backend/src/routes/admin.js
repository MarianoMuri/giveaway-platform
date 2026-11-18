const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const requireAdmin = require('../middleware/auth');
const { Raffle, Order } = require('../db');
const { createRaffle, manualSale, drawWinner, raffleStats, cleanGoal, HttpError } = require('../services/orders');
const packs = require('../services/packs');
const emails = require('../services/emails');
const freeEntries = require('../services/freeEntries');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const valid =
    email === config.admin.email &&
    config.admin.passwordHash &&
    (await bcrypt.compare(String(password || ''), config.admin.passwordHash));
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
  res.json({ token: jwt.sign({ email }, config.jwtSecret, { expiresIn: '12h' }) });
});

router.use(requireAdmin);

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
  const allowed = ['title', 'description', 'prize', 'imageUrl', 'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'chancesGoal', 'freeEntryEnabled'];
  const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if ('chancesGoal' in changes) changes.chancesGoal = cleanGoal(changes.chancesGoal);
  if (changes.status && !['draft', 'active', 'closed'].includes(changes.status)) {
    throw new HttpError(400, 'Estado inválido'); // "drawn" solo se pone al cargar el ganador
  }
  res.json(await raffle.update(changes));
}));

// Cargar el número ganador del sorteo en vivo
router.post('/raffles/:id/winner', wrap(async (req, res) => {
  res.json(await drawWinner(req.params.id, req.body?.number));
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

router.get('/orders', wrap(async (req, res) => {
  const where = {};
  if (req.query.raffleId) where.RaffleId = req.query.raffleId;
  if (req.query.status) where.status = req.query.status;
  res.json(await Order.findAll({ where, order: [['createdAt', 'DESC']], limit: 500 }));
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
router.get('/raffles/:id/export.csv', wrap(async (req, res) => {
  const orders = await Order.findAll({
    where: { RaffleId: req.params.id, status: ['approved', 'manual', 'needs_review'] },
    order: [['createdAt', 'ASC']],
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Fecha', 'Nombre', 'DNI', 'Teléfono', 'Email', 'Curso', 'Chances', 'Desde', 'Hasta', 'Monto', 'Estado', 'Pago MP'].join(';')];
  for (const o of orders) {
    lines.push([o.createdAt.toISOString(), o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail, o.courseTitle,
      o.chances, o.firstNumber, o.lastNumber, Number(o.amount).toFixed(2), o.status, o.mpPaymentId].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="sorteo-${req.params.id}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

module.exports = router;
