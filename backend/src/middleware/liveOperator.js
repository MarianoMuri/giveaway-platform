// "Operador del sorteo en vivo": un usuario que solo puede ver la lista de sorteos y sortear.
// No ve recaudación, compradores, cursos ni configuración, y del ganador recibe solo lo que se muestra
// en pantalla (nombre abreviado y últimos 3 dígitos del DNI), nunca teléfono ni email.
// El administrador completo (sin rol, o rol "admin") no pasa por acá.
const mask = {
  name: (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
  },
  dni: (dni) => String(dni || '').replace(/\D/g, '').slice(-3),
};

const { Raffle } = require('../db');

const RAFFLE_FIELDS = ['id', 'title', 'prize', 'status', 'salesCloseAt', 'winnerNumber', 'drawDate', 'liveEnabled'];

module.exports = function liveOperator(req, res, next) {
  handle(req, res, next).catch(next);
};

async function handle(req, res, next) {
  if (req.admin?.role !== 'live') return next();
  const path = req.path;

  if (req.method === 'GET' && path === '/raffles') {
    const json = res.json.bind(res);
    res.json = (rows) => json((rows || []).map((r) => Object.fromEntries(RAFFLE_FIELDS.map((k) => [k, r[k]]))));
    return next();
  }
  if (req.method === 'POST' && /^\/raffles\/\d+\/draw$/.test(path)) {
    // El administrador puede deshabilitar un sorteo para que no se abra por error
    const raffle = await Raffle.findByPk(Number(path.split('/')[2]));
    if (raffle && raffle.liveEnabled === false) return res.status(403).json({ error: 'Este sorteo está deshabilitado para el vivo. Pedile al administrador que lo habilite.' });
    const json = res.json.bind(res);
    res.json = (out) => (out && out.winner
      ? json({ number: out.number, draw: out.draw ? { id: out.draw.id, number: out.draw.number } : null,
        winner: { name: mask.name(out.winner.name), dni: mask.dni(out.winner.dni), source: out.winner.source } })
      : json(out));
    return next();
  }
  return res.status(403).json({ error: 'Este usuario solo puede hacer el sorteo en vivo' });
}
