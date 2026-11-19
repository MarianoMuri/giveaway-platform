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

// Antes de abrir la venta el sorteo debe tener su autorización y sus bases cargadas: sin eso no se puede
// vender. El texto lo redacta y aprueba el abogado del cliente; acá solo se exige que exista.
const MIN_TERMS_CHARS = 100;

function missingBeforeOpening({ permitNumber, terms }) {
  const missing = [];
  if (!String(permitNumber || '').trim()) missing.push('el N° de autorización');
  if (String(terms || '').trim().length < MIN_TERMS_CHARS) missing.push('las bases y condiciones');
  return missing;
}

function assertCanOpen(raffle) {
  const missing = missingBeforeOpening(raffle);
  if (missing.length) throw new HttpError(409, `Para abrir la venta falta cargar ${missing.join(' y ')}`, { code: 'legal_missing', missing });
}

module.exports = { isOpen, assertOpen, missingBeforeOpening, assertCanOpen, MIN_TERMS_CHARS };
