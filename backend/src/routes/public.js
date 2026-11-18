const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const { Raffle, Order, Ticket } = require('../db');
const { reserveAndCreateOrder } = require('../services/orders');
const packs = require('../services/packs');

const publicFields = [
  'id', 'title', 'description', 'prize', 'imageUrl', 'pricePerNumber', 'promos', 'totalNumbers',
  'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'winnerNumber',
];

router.get('/raffles', async (req, res) => {
  const raffles = await Raffle.findAll({
    where: { status: { [Op.ne]: 'draft' } },
    attributes: publicFields,
    order: [['drawDate', 'DESC']],
  });
  res.json(raffles);
});

router.get('/raffles/:id', async (req, res) => {
  const raffle = await Raffle.findOne({
    where: { id: req.params.id, status: { [Op.ne]: 'draft' } },
    attributes: publicFields,
  });
  if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json(raffle);
});

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const quoteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60 });

// Packs a la venta, con el total de "Duplicá" ya calculado por el backend
router.get('/raffles/:id/packs', wrap(async (req, res) => {
  const config = await packs.getConfig(req.params.id);
  if (config.raffle.status === 'draft') return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json(packs.publicView(config));
}));

// Cotización de una compra: el frontend nunca calcula el total
router.post('/raffles/:id/quote', quoteLimiter, wrap(async (req, res) => {
  const { packId, double } = req.body || {};
  res.json(await packs.quoteForRaffle(req.params.id, { packId, double }));
}));

// Estado de la grilla: 0 = libre, 1 = reservado, 2 = vendido (compacto para miles de números)
router.get('/raffles/:id/numbers', async (req, res) => {
  const tickets = await Ticket.findAll({
    where: { RaffleId: req.params.id },
    attributes: ['number', 'status', 'reservedUntil'],
    order: [['number', 'ASC']],
    raw: true,
  });
  const now = new Date();
  const grid = tickets.map((t) => {
    if (t.status === 'sold') return 2;
    if (t.status === 'reserved' && new Date(t.reservedUntil) > now) return 1;
    return 0;
  });
  res.json({ grid });
});

const buyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.post('/orders', buyLimiter, async (req, res, next) => {
  try {
    const { raffleId, numbers, buyer } = req.body;
    res.status(201).json(await reserveAndCreateOrder({ raffleId, numbers, buyer }));
  } catch (e) {
    next(e);
  }
});

// Página de retorno: el comprador consulta el estado de su compra
router.get('/orders/:id', async (req, res) => {
  const order = await Order.findByPk(req.params.id, {
    attributes: ['id', 'status', 'numbers', 'amount', 'buyerName', 'expiresAt', 'RaffleId'],
  });
  if (!order) return res.status(404).json({ error: 'Compra no encontrada' });
  res.json(order);
});

module.exports = router;
