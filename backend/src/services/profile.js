// Dato opcional del comprador para estadísticas y publicidad: la localidad.
// Es opcional y nunca bloquea una compra. No se pide edad, género ni ocupación (Meta Ads ya muestra edad y género
// de quienes compran, sin que nadie complete nada).

// "  bahía   blanca " -> "Bahía Blanca" (así "bahia blanca" y "BAHIA BLANCA" se agrupan parecido)
function cleanLocality(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (s.length < 2) return null;
  return s.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function cleanProfile(input) {
  return { locality: cleanLocality((input || {}).locality) };
}

module.exports = { cleanProfile, cleanLocality };
