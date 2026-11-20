const { AuditLog } = require('../db');

// Registra una acción de un administrador. Si el registro falla no se tapa en silencio: queda en el
// log del servidor, pero no se rompe la acción que ya se hizo.
async function record({ actor, action, raffleId = null, detail = null, ip = null }, transaction) {
  try {
    return await AuditLog.create(
      { actor: String(actor || 'desconocido').slice(0, 200), action, RaffleId: raffleId, detail: detail ? String(detail).slice(0, 2000) : null, ip: ip ? String(ip).slice(0, 80) : null },
      { transaction }
    );
  } catch (e) {
    console.error('[auditoría] no se pudo registrar', action, e.message);
    return null;
  }
}

const who = (req) => ({ actor: req.admin?.email, ip: req.ip });

// Describe una acción del panel para el registro. Solo se guardan datos que identifican QUÉ se hizo,
// nunca datos personales de compradores ni contraseñas.
const pick = (body, keys) =>
  keys.filter((k) => k in (body || {})).map((k) => `${k}=${typeof body[k] === 'string' && body[k].length > 60 ? '…' : body[k]}`).join(', ');

const TABLE = [
  ['POST', /^\/raffles$/, 'raffle.create', (r) => ({ detail: `title=${r.body?.title}` })],
  ['PATCH', /^\/raffles\/(\d+)$/, 'raffle.update', (r, m) => ({ raffleId: Number(m[1]), detail: pick(r.body, ['status', 'salesCloseAt', 'freeEntryEnabled', 'liveEnabled', 'liveHidden', 'publicHidden', 'drawDate', 'chancesGoal', 'title', 'prize', 'description', 'terms', 'imageUrl', 'youtubeUrl', 'permitNumber', 'excludedProvinces']) })],
  ['PUT', /^\/raffles\/(\d+)\/packs$/, 'packs.update', (r, m) => ({ raffleId: Number(m[1]), detail: `${(r.body?.packs || []).length} packs` })],
  ['POST', /^\/raffles\/(\d+)\/readiness$/, 'readiness.check', (r, m) => ({ raffleId: Number(m[1]) })],
  ['POST', /^\/orders\/manual$/, 'order.manual', (r) => ({ raffleId: Number(r.body?.raffleId) || null, detail: `chances=${r.body?.chances}, amount=${r.body?.amount}` })],
  ['POST', /^\/orders\/([\w-]+)\/resend-email$/, 'order.resend_email', (r, m) => ({ detail: `order=${m[1]}` })],
  ['POST', /^\/free-entries\/([\w-]+)\/void$/, 'free_entry.void', (r, m) => ({ detail: `entry=${m[1]}` })],
  ['POST', /^\/courses$/, 'course.create', () => ({})],
  ['PUT', /^\/courses\/(\d+)$/, 'course.update', (r, m) => ({ detail: `course=${m[1]}` })],
  ['PATCH', /^\/courses\/(\d+)$/, 'course.update', (r, m) => ({ detail: `course=${m[1]}` })],
  ['DELETE', /^\/courses\/(\d+)$/, 'course.delete', (r, m) => ({ detail: `course=${m[1]}` })],
];

// Middleware: registra toda acción de modificación del panel que terminó bien. Los sorteos
// (draw/winner) se registran en el servicio, con más detalle (res.locals.audited).
// El registro se escribe cuando la respuesta ya salió. Se guardan las escrituras en curso para que
// una lectura del registro espere a las anteriores y nunca muestre un listado al que le falta la última acción.
const pending = new Set();
const flush = () => Promise.allSettled([...pending]);

function trail(req, res, next) {
  res.on('finish', () => {
    if (req.method === 'GET' || res.statusCode >= 400 || res.locals.audited) return;
    const found = TABLE.find(([method, re]) => method === req.method && re.test(req.path));
    const entry = found
      ? { action: found[2], ...found[3](req, req.path.match(found[1])) }
      : { action: `${req.method} ${req.path}` };
    const p = record({ ...who(req), ...entry }).finally(() => pending.delete(p));
    pending.add(p);
  });
  next();
}

module.exports = { record, trail, who, flush };
