const { HttpError } = require('./errors');

// La venta está abierta si el sorteo está activo y todavía no llegó la fecha de cierre (si hay una).
// Se calcula cada vez que se pregunta: no hace falta ningún proceso programado que "cierre" el sorteo.
function isOpen(raffle, now = new Date()) {
  if (raffle.status !== 'active') return false;
  return !raffle.salesCloseAt || now < new Date(raffle.salesCloseAt);
}

function assertOpen(raffle, message) {
  if (isOpen(raffle)) return;
  if (raffle.status === 'active') throw new HttpError(409, 'La venta de este sorteo ya cerró');
  throw new HttpError(409, message);
}

module.exports = { isOpen, assertOpen };
