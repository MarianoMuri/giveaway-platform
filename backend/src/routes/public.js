const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { Op, fn, col } = require('sequelize');
const { Raffle, Order, Pack, Chance } = require('../db');
const packs = require('../services/packs');
const { createPurchase } = require('../services/purchases');

const publicFields = [
  'id', 'title', 'description', 'prize', 'imageUrl', 'chancesGoal',
  'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'winnerNumber',
];

// Agrega a cada sorteo las chances vendidas (barra de progreso) y el precio del pack más barato
async function withSales(raffles) {
  const ids = raffles.map((r) => r.id);
  if (!ids.length) return [];
  const [sold, prices] = await Promise.all([
    Chance.findAll({ where: { RaffleId: ids, status: 'valid' }, attributes: ['RaffleId', [fn('COUNT', col('id')), 'n']], group: ['RaffleId'], raw: true }),
    Pack.findAll({ where: { RaffleId: ids }, attributes: ['RaffleId', [fn('MIN', col('price')), 'min']], group: ['RaffleId'], raw: true }),
  ]);
  const soldBy = new Map(sold.map((r) => [r.RaffleId, Number(r.n)]));
  const priceBy = new Map(prices.map((r) => [r.RaffleId, Number(r.min)]));
  return raffles.map((r) => ({ ...r.toJSON(), chancesSold: soldBy.get(r.id) || 0, fromPrice: priceBy.get(r.id) ?? null }));
}

const wrap = (handler) => (req, res, next) => handler(req, res).catch(next);

router.get('/raffles', wrap(async (req, res) => {
  const raffles = await Raffle.findAll({
    where: { status: { [Op.ne]: 'draft' } },
    attributes: publicFields,
    order: [['drawDate', 'DESC']],
  });
  res.json(await withSales(raffles));
}));

router.get('/raffles/:id', wrap(async (req, res) => {
  const raffle = await Raffle.findOne({
    where: { id: req.params.id, status: { [Op.ne]: 'draft' } },
    attributes: publicFields,
  });
  if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json((await withSales([raffle]))[0]);
}));
const buyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const quoteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60 });

// Packs a la venta, con el total de "Duplicá" ya calculado por el backend
router.get('/raffles/:id/packs', wrap(async (req, res) => {
  const config = await packs.getConfig(req.params.id);
  if (config.raffle.status === 'draft') return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json(packs.publicView(config));
}));

// Compra de curso + pack: crea la orden y devuelve el link de pago
router.post('/raffles/:id/purchases', buyLimiter, wrap(async (req, res) => {
  const { packId, double, courseId, buyer } = req.body || {};
  res.status(201).json(await createPurchase({ raffleId: req.params.id, packId, double: double === true, courseId, buyer }));
}));

// Cotización de una compra: el frontend nunca calcula el total
router.post('/raffles/:id/quote', quoteLimiter, wrap(async (req, res) => {
  const { packId, double } = req.body || {};
  res.json(await packs.quoteForRaffle(req.params.id, { packId, double }));
}));

// Página de retorno: el comprador consulta el estado de su compra
// El id es un UUID imposible de adivinar: funciona como "link privado" de la compra
router.get('/orders/:id', wrap(async (req, res) => {
  const order = await Order.findByPk(req.params.id, {
    attributes: ['id', 'status', 'amount', 'buyerName', 'RaffleId', 'chances', 'double', 'firstNumber', 'lastNumber', 'courseTitle', 'createdAt'],
    include: { model: Raffle, attributes: ['id', 'title', 'prize', 'drawDate', 'youtubeUrl'] },
  });
  if (!order) return res.status(404).json({ error: 'Compra no encontrada' });
  res.json(order);
}));

module.exports = router;
