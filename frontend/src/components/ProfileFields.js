// Dato opcional para estadísticas: la localidad. No es obligatorio y no se usa para decidir quién gana:
// solo ayuda al organizador a saber dónde hacer publicidad.
export default function ProfileFields({ value, onChange }) {
  return (
    <fieldset className="profile-fields">
      <legend className="small muted">Opcional · nos ayuda a saber de dónde nos escriben</legend>
      <label>Localidad
        <input maxLength={80} autoComplete="address-level2" placeholder="Ej: Bahía Blanca" value={value.locality || ''} onChange={(e) => onChange({ ...value, locality: e.target.value })} />
      </label>
    </fieldset>
  );
}
