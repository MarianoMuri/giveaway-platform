import { useApi } from '../hooks';

// Datos opcionales para estadísticas (localidad, edad, género, ocupación). Nada de esto es obligatorio
// y no se usa para decidir quién gana: solo ayuda al organizador a saber dónde y a quién llegar.
export default function ProfileFields({ value, onChange }) {
  const { data: opts } = useApi('/profile-options');
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const select = (key, label, list) => (
    <label>{label}
      <select value={value[key] || ''} onChange={set(key)}>
        <option value="">Prefiero no decirlo</option>
        {(list || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset className="profile-fields">
      <legend className="small muted">Opcional · nos ayuda a conocer a quienes participan</legend>
      <label>Localidad
        <input maxLength={80} autoComplete="address-level2" placeholder="Ej: Bahía Blanca" value={value.locality || ''} onChange={set('locality')} />
      </label>
      {select('ageRange', 'Edad', opts?.ageRanges)}
      {select('gender', 'Género', opts?.genders)}
      {select('occupation', 'Ocupación', opts?.occupations)}
    </fieldset>
  );
}
