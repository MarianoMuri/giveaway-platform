// Datos opcionales del comprador para estadísticas y publicidad: localidad, edad (por rango), género y ocupación.
// Todo es opcional y nunca bloquea una compra: un valor inválido simplemente se descarta.
// No se guarda la fecha de nacimiento, solo el rango de edad.
const AGE_RANGES = [
  { value: '18-24', label: '18 a 24 años' },
  { value: '25-34', label: '25 a 34 años' },
  { value: '35-44', label: '35 a 44 años' },
  { value: '45-54', label: '45 a 54 años' },
  { value: '55+', label: '55 años o más' },
];
const GENDERS = [
  { value: 'F', label: 'Mujer' },
  { value: 'M', label: 'Varón' },
  { value: 'X', label: 'Otro' },
];
const OCCUPATIONS = [
  { value: 'employee', label: 'Empleado/a' },
  { value: 'self', label: 'Independiente o comerciante' },
  { value: 'professional', label: 'Profesional' },
  { value: 'teacher', label: 'Docente' },
  { value: 'student', label: 'Estudiante' },
  { value: 'retired', label: 'Jubilado/a' },
  { value: 'other', label: 'Otra' },
];

const pick = (list, v) => (list.some((o) => o.value === v) ? v : null);

// "  bahía   blanca " -> "Bahía Blanca" (así "bahia blanca" y "BAHIA BLANCA" se agrupan parecido)
function cleanLocality(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (s.length < 2) return null;
  return s.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function cleanProfile(input) {
  const p = input || {};
  return {
    locality: cleanLocality(p.locality),
    ageRange: pick(AGE_RANGES, p.ageRange),
    gender: pick(GENDERS, p.gender),
    occupation: pick(OCCUPATIONS, p.occupation),
  };
}

const options = () => ({ ageRanges: AGE_RANGES, genders: GENDERS, occupations: OCCUPATIONS });

module.exports = { cleanProfile, cleanLocality, options, AGE_RANGES, GENDERS, OCCUPATIONS };
