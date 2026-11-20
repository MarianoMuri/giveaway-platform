const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const requireAdmin = require('../middleware/auth');
const liveOperator = require('../middleware/liveOperator');
const { Raffle, Order, Chance, OrderEvent, FreeEntry } = require('../db');
const { createRaffle, manualSale, raffleStats, cleanGoal, HttpError } = require('../services/orders');
const packs = require('../services/packs');
const emails = require('../services/emails');
const readiness = require('../services/readiness');
const freeEntries = require('../services/freeEntries');
const { search } = require('../services/search');
const audit = require('../services/audit');
const { streamRaffleCsv } = require('../services/export');
const mpHealth = require('../services/mpHealth');
const draw = require('../services/draw');
const winnerAlert = require('../services/winnerAlert');
const { segmentSales } = require('../services/segments');
const sales = require('../services/sales');
const { cleanExcluded } = require('../services/provinces');
const { AuditLog } = require('../db');
const totp = require('../services/totp');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const matches = async (u) => u.email && u.passwordHash && String(email || '').trim().toLowerCase() === u.email.trim().toLowerCase() && (await bcrypt.compare(String(password || ''), u.passwordHash));
  // El administrador tiene prioridad: si los dos mails fueran iguales, entra como administrador
  const role = (await matches(config.admin)) ? 'admin' : (await matches(config.liveOperator)) ? 'live' : null;
  if (!role) {
    await audit.record({ actor: String(email || '').slice(0, 100) || 'desconocido', action: 'login.failed', ip: req.ip });
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  // Doble verificación: solo para el administrador, y solo si está activada (ADMIN_TOTP_SECRET)
  if (role === 'admin' && config.admin.totpSecret) {
    const code = String((req.body || {}).code || '').trim();
    if (!code) return res.status(401).json({ error: 'Ingresá el código de 6 números de tu app de autenticación', needsCode: true });
    if (!totp.verify(config.admin.totpSecret, code)) {
      await audit.record({ actor: String(email || '').slice(0, 100), action: 'login.failed.2fa', ip: req.ip });
      return res.status(401).json({ error: 'Código incorrecto o vencido. Probá con el que se muestra ahora.', needsCode: true });
    }
  }
  await audit.record({ actor: email, action: role === 'live' ? 'login.ok.live' : 'login.ok', ip: req.ip });
  res.json({ role, token: jwt.sign({ email, role }, config.jwtSecret, { expiresIn: '12h' }) });
});

router.use(requireAdmin.orLive);
router.use(liveOperator);
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
  const allowed = ['title', 'description', 'prize', 'imageUrl', 'drawDate', 'youtubeUrl', 'permitNumber', 'terms', 'status', 'chancesGoal', 'freeEntryEnabled', 'salesCloseAt', 'excludedProvinces', 'liveEnabled', 'liveHidden', 'publicHidden'];
  const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  for (const k of ['title', 'prize']) {
    if (k in changes) {
      changes[k] = String(changes[k] ?? '').trim();
      if (!changes[k]) throw new HttpError(400, k === 'title' ? 'El nombre del sorteo no puede quedar vacío' : 'El premio no puede quedar vacío');
      if (changes[k].length > 200) throw new HttpError(400, 'Es demasiado largo (máximo 200 letras)');
    }
  }
  for (const k of ['liveEnabled', 'liveHidden', 'publicHidden']) {
    if (k in changes && typeof changes[k] !== 'boolean') throw new HttpError(400, 'Valor inválido');
  }
  if ('chancesGoal' in changes) changes.chancesGoal = cleanGoal(changes.chancesGoal);
  if ('salesCloseAt' in changes) {
    if (changes.salesCloseAt === '' || changes.salesCloseAt === null) changes.salesCloseAt = null;
    else if (Number.isNaN(new Date(changes.salesCloseAt).getTime())) throw new HttpError(400, 'La fecha de cierre no es válida');
  }
  if ('excludedProvinces' in changes) changes.excludedProvinces = cleanExcluded(changes.excludedProvinces);
  if (changes.status && !['draft', 'active', 'closed'].includes(changes.status)) {
    throw new HttpError(400, 'Estado inválido'); // "drawn" solo se pone al cargar el ganador
  }
  if (changes.status && raffle.status === 'drawn') throw new HttpError(409, 'El sorteo ya se realizó: no se puede cambiar el estado de la venta');
  // Para abrir (o reabrir) la venta, el sorteo ya tiene que tener autorización y bases, con los cambios de este mismo pedido
  if (changes.status === 'active') sales.assertCanOpen({ permitNumber: raffle.permitNumber, terms: raffle.terms, ...changes });
  res.json(await raffle.update(changes));
}));

// Cargar el número ganador del sorteo en vivo
router.post('/raffles/:id/winner', wrap(async (req, res) => {
  res.locals.audited = true; // lo registra el servicio, con el detalle del sorteo
  const result = await draw.loadManual(req.params.id, req.body?.number, { ...audit.who(req), reason: req.body?.reason });
  winnerAlert.deliverSoon(result.draw.id); // sin esperar: no demora ni hace fallar la respuesta
  res.json(result);
}));

// Sorteo en vivo: el servidor elige el ganador al azar entre los números válidos
router.post('/raffles/:id/draw', wrap(async (req, res) => {
  res.locals.audited = true;
  const result = await draw.drawRandom(req.params.id, { ...audit.who(req), reason: req.body?.reason });
  winnerAlert.deliverSoon(result.draw.id); // sin esperar: no demora ni hace fallar la respuesta
  res.json(result);
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

// "Dónde compran y quiénes": ventas por provincia, localidad, edad, género u ocupación (?by=...)
router.get('/raffles/:id/segments', wrap(async (req, res) => {
  const result = await segmentSales(req.params.id, String(req.query.by || 'province'));
  if (!result) throw new HttpError(400, 'Segmento inválido');
  res.json(result);
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
  await streamRaffleCsv(Number(req.params.id), res);
}));

module.exports = router;
