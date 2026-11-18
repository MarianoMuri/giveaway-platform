const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const requireAdmin = require('../middleware/auth');
const { sequelize, Raffle, Order, Ticket } = require('../db');
const { createRaffle, manualSale, HttpError, validatePromos } = require('../services/orders');
const packs = require('../services/packs');

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
  const { totalNumbers } = req.body;
  if (!Number.isInteger(totalNumbers) || totalNumbers < 1 || totalNumbers > 100000) {
    throw new HttpError(400, 'totalNumbers debe ser entre 1 y 100000');
  }
  res.status(201).json(await createRaffle(req.body));
}));

// No se permite cambiar el precio base ni la cantidad de números una vez creado (las promos sí)
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
  const allowed = ['title', 'description', 'prize', 'imageUrl', 'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'promos'];
  const changes = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if ('promos' in changes) {
    try {
      changes.promos = validatePromos(changes.promos);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }
  res.json(await raffle.update(changes));
}));

// Cargar el número ganador del sorteo en vivo
router.post('/raffles/:id/winner', wrap(async (req, res) => {
  const raffle = await Raffle.findByPk(req.params.id);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const number = Number(req.body.number);
  const ticket = await Ticket.findOne({ where: { RaffleId: raffle.id, number }, include: Order });
  if (!ticket) throw new HttpError(400, 'Número fuera de rango');
  await raffle.update({ winnerNumber: number, status: 'drawn' });
  res.json({
    number,
    sold: ticket.status === 'sold',
    winner: ticket.status === 'sold' && ticket.Order
      ? { name: ticket.Order.buyerName, phone: ticket.Order.buyerPhone, email: ticket.Order.buyerEmail, dni: ticket.Order.buyerDni }
      : null,
  });
}));

router.get('/raffles/:id/stats', wrap(async (req, res) => {
  const rows = await Ticket.findAll({
    where: { RaffleId: req.params.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });
  const revenue = await Order.sum('amount', { where: { RaffleId: req.params.id, status: ['approved', 'manual'] } });
  res.json({ byStatus: Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])), revenue: Number(revenue || 0) });
}));

router.get('/orders', wrap(async (req, res) => {
  const where = {};
  if (req.query.raffleId) where.RaffleId = req.query.raffleId;
  if (req.query.status) where.status = req.query.status;
  res.json(await Order.findAll({ where, order: [['createdAt', 'DESC']], limit: 500 }));
}));

router.post('/orders/manual', wrap(async (req, res) => {
  res.status(201).json(await manualSale(req.body));
}));

// Exportación CSV de compradores (se abre en Excel)
router.get('/raffles/:id/export.csv', wrap(async (req, res) => {
  const orders = await Order.findAll({
    where: { RaffleId: req.params.id, status: ['approved', 'manual', 'needs_review'] },
    order: [['createdAt', 'ASC']],
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Fecha', 'Nombre', 'DNI', 'Teléfono', 'Email', 'Números', 'Monto', 'Estado', 'Pago MP'].join(';')];
  for (const o of orders) {
    lines.push([o.createdAt.toISOString(), o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail,
      o.chances ? (o.firstNumber ? `${o.firstNumber}-${o.lastNumber}` : '') : o.numbers.join(' '), o.amount, o.status, o.mpPaymentId].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="sorteo-${req.params.id}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

module.exports = router;
