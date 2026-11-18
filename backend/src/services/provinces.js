const { HttpError } = require('./errors');

// Las 24 jurisdicciones del país, con el código de la norma ISO 3166-2:AR.
const PROVINCES = [
  { code: 'A', name: 'Salta' },
  { code: 'B', name: 'Buenos Aires' },
  { code: 'C', name: 'Ciudad Autónoma de Buenos Aires' },
  { code: 'D', name: 'San Luis' },
  { code: 'E', name: 'Entre Ríos' },
  { code: 'F', name: 'La Rioja' },
  { code: 'G', name: 'Santiago del Estero' },
  { code: 'H', name: 'Chaco' },
  { code: 'J', name: 'San Juan' },
  { code: 'K', name: 'Catamarca' },
  { code: 'L', name: 'La Pampa' },
  { code: 'M', name: 'Mendoza' },
  { code: 'N', name: 'Misiones' },
  { code: 'P', name: 'Formosa' },
  { code: 'Q', name: 'Neuquén' },
  { code: 'R', name: 'Río Negro' },
  { code: 'S', name: 'Santa Fe' },
  { code: 'T', name: 'Tucumán' },
  { code: 'U', name: 'Chubut' },
  { code: 'V', name: 'Tierra del Fuego' },
  { code: 'W', name: 'Corrientes' },
  { code: 'X', name: 'Córdoba' },
  { code: 'Y', name: 'Jujuy' },
  { code: 'Z', name: 'Santa Cruz' },
].sort((a, b) => a.name.localeCompare(b.name, 'es'));

const CODES = new Set(PROVINCES.map((p) => p.code));
const NAME = new Map(PROVINCES.map((p) => [p.code, p.name]));

// Provincias con régimen propio para sorteos promocionales (autorización previa, tasas o escribano):
// Mendoza, Neuquén, Río Negro, Salta, Tierra del Fuego y Jujuy; Formosa se excluye por práctica de mercado.
// Quedan excluidas por defecto hasta que el abogado del cliente resuelva el trámite de cada una.
const DEFAULT_EXCLUDED = ['M', 'P', 'Y', 'Q', 'A', 'R', 'V'];

// Normaliza una lista de códigos (array o texto separado por comas): sin repetidos, solo códigos válidos
function parseCodes(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
}

function cleanExcluded(value) {
  const codes = parseCodes(value);
  const bad = codes.filter((c) => !CODES.has(c));
  if (bad.length) throw new HttpError(400, `Provincia desconocida: ${bad.join(', ')}`);
  return codes;
}

// Provincia del comprador: obligatoria y válida
function cleanProvince(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) throw new HttpError(400, 'Elegí tu provincia');
  if (!CODES.has(code)) throw new HttpError(400, 'La provincia no es válida');
  return code;
}

// Rechaza la operación si el sorteo no está habilitado en esa provincia
function assertAvailable(raffle, code) {
  if (!parseCodes(raffle.excludedProvinces).includes(code)) return;
  throw new HttpError(409, `Por el momento este sorteo no está disponible en ${NAME.get(code)}`, { code: 'province_excluded' });
}

module.exports = { PROVINCES, DEFAULT_EXCLUDED, parseCodes, cleanExcluded, cleanProvince, assertAvailable };
