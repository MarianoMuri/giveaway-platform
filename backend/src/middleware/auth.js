const jwt = require('jsonwebtoken');
const config = require('../config');

// Valida el token. Por defecto el operador del sorteo en vivo (rol "live") queda AFUERA: cualquier ruta
// nueva que use requireAdmin es solo para el administrador. El router de admin usa requireAdmin.orLive
// y después middleware/liveOperator.js deja pasar solo lo que ese usuario necesita.
function check({ allowLive }) {
  return function requireAdmin(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
      req.admin = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Sesión vencida' });
    }
    if (req.admin.role === 'live' && !allowLive) return res.status(403).json({ error: 'Este usuario solo puede hacer el sorteo en vivo' });
    next();
  };
}

module.exports = check({ allowLive: false });
module.exports.orLive = check({ allowLive: true });
