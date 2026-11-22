// Lo que un sorteo necesita antes de abrir la venta (el backend valida lo mismo: sales.js)
export const MIN_TERMS_CHARS = 100;

export function missingBeforeOpening({ terms }) {
  const missing = [];
  if (String(terms || '').trim().length < MIN_TERMS_CHARS) missing.push('las bases y condiciones');
  return missing;
}
