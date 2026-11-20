const router = require('express').Router();
const config = require('../config');
const rateLimit = require('express-rate-limit');
const { Op, fn, col } = require('sequelize');
const { Raffle, Order, Pack, Chance } = require('../db');
const packs = require('../services/packs');
const { createPurchase } = require('../services/purchases');
const courses = require('../services/courses');
const myPurchases = require('../services/myPurchases');
const freeEntries = require('../services/freeEntries');
const sales = require('../services/sales');
const { PROVINCES } = require('../services/provinces');

const publicFields = [
  'id', 'title', 'description', 'prize', 'imageUrl', 'chancesGoal',
  'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'winnerNumber', 'freeEntryEnabled', 'salesCloseAt', 'excludedProvinces',
];

// Agrega a cada sorteo el precio del pack más barato. Las chances vendidas NO se publican: solo las ve el administrador.
async function withPrices(raffles) {
  const ids = raffles.map((r) => r.id);
  if (!ids.length) return [];
  const prices = await Pack.findAll({ where: { RaffleId: ids }, attributes: ['RaffleId', [fn('MIN', col('price')), 'min']], group: ['RaffleId'], raw: true });
  const priceBy = new Map(prices.map((r) => [r.RaffleId, Number(r.min)]));
  return raffles.map((r) => ({ ...r.toJSON(), salesOpen: sales.isOpen(r), fromPrice: priceBy.get(r.id) ?? null }));
}

// Las 24 jurisdicciones, para el selector de provincia
router.get('/provinces', (req, res) => res.json(PROVINCES));

const wrap = (handler) => (req, res, next) => handler(req, res).catch(next);

router.get('/raffles', wrap(async (req, res) => {
  const raffles = await Raffle.findAll({
    where: { status: { [Op.ne]: 'draft' }, publicHidden: false }, // los ocultos no salen en la página de inicio (siguen andando con su link)
    attributes: publicFields,
    order: [['drawDate', 'DESC']],
  });
  res.json(await withPrices(raffles));
}));

router.get('/raffles/:id', wrap(async (req, res) => {
  const raffle = await Raffle.findOne({
    where: { id: req.params.id, status: { [Op.ne]: 'draft' } },
    attributes: publicFields,
  });
  if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json((await withPrices([raffle]))[0]);
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
  const { packId, double, courseId, buyer, code } = req.body || {};
  res.status(201).json(await createPurchase({ raffleId: req.params.id, packId, double: double === true, courseId, buyer, code }));
}));

// Cotización de una compra: el frontend nunca calcula el total
// Los códigos de promo no se pueden adivinar a fuerza de probar: con código, el límite es más estricto
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Probaste muchos códigos. Esperá unos minutos y reintentá.' } });
router.post('/raffles/:id/quote', quoteLimiter, (req, res, next) => (req.body?.code ? codeLimiter(req, res, next) : next()), wrap(async (req, res) => {
  const { packId, double, code } = req.body || {};
  res.json(await packs.quoteForRaffle(req.params.id, { packId, double, code }));
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

// Link de descarga nuevo para una compra pagada (el del email vence)
const downloadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
router.post('/orders/:id/download-link', downloadLimiter, wrap(async (req, res) => {
  const order = await Order.findByPk(req.params.id, { attributes: ['id', 'status', 'CourseId'] });
  if (!order) return res.status(404).json({ error: 'Compra no encontrada' });
  if (!['approved', 'manual'].includes(order.status)) return res.status(409).json({ error: 'La compra todavía no está acreditada' });
  if (!order.CourseId) return res.status(404).json({ error: 'El curso ya no está disponible' });
  res.json({ url: courses.downloadUrl(order.CourseId, 1) });
}));

// "Mis compras" con link mágico: el comprador pide un link por email y con él ve sus compras.
// Responde siempre lo mismo exista o no el email (no se puede averiguar quién compró).
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
router.post('/my-purchases/link', linkLimiter, wrap(async (req, res) => {
  const pending = myPurchases.requestLink(req.body?.email);
  // Un email con formato inválido se rechaza al instante; el resto se resuelve sin esperar al proveedor de mail
  await Promise.race([pending, new Promise((r) => setTimeout(r, 0))]);
  pending.catch((e) => { if (!e.status) console.error('[mis-compras] no se pudo enviar el link:', e.message); });
  res.status(202).json({ ok: true });
}));

// "Mis compras" con DNI: solo lectura de números. Límite por IP acá, por DNI y captcha en el servicio.
const dniLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.post('/my-purchases/by-dni', dniLimiter, wrap(async (req, res) => {
  const { dni, captchaToken } = req.body || {};
  res.json(await myPurchases.listByDni({ dni, captchaToken, ip: req.ip }));
}));
router.post('/my-purchases/download', dniLimiter, wrap(async (req, res) => {
  const { dni, email, orderId } = req.body || {};
  res.json(await myPurchases.downloadWithEmail({ dni, email, orderId, ip: req.ip }));
}));

router.get('/my-purchases', wrap(async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  res.json(await myPurchases.listPurchases(token));
}));

// Participación gratuita "sin obligación de compra": pide el número y confirma el email
const freeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.freeEntries.requestsPer15Min, standardHeaders: true, legacyHeaders: false });
const confirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.freeEntries.requestsPer15Min, standardHeaders: true, legacyHeaders: false });
router.post('/raffles/:id/free-entries', freeLimiter, wrap(async (req, res) => {
  const { name, dni, email, phone, province, locality, captchaToken, deviceId } = req.body || {};
  res.status(202).json(await freeEntries.request({ raffleId: req.params.id, name, dni, email, phone, province, locality, captchaToken, deviceId, ip: req.ip }));
}));

router.post('/free-entries/confirm', confirmLimiter, wrap(async (req, res) => {
  res.json(await freeEntries.confirm(req.body?.token));
}));

module.exports = router;
