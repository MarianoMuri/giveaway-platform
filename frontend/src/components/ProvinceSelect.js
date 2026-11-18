import { useApi } from '../hooks';

// Selector de provincia de la compra o participación. Las provincias donde el sorteo no se ofrece
// aparecen deshabilitadas; el backend vuelve a validarlo igual.
export default function ProvinceSelect({ value, onChange, excluded = [] }) {
  const { data: provinces } = useApi('/provinces');
  const blocked = (provinces || []).filter((p) => excluded.includes(p.code));
  return (
    <>
      <label>Provincia
        <select required className="province-select" autoComplete="address-level1" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegí tu provincia</option>
          {(provinces || []).map((p) => (
            <option key={p.code} value={p.code} disabled={excluded.includes(p.code)}>
              {p.name}{excluded.includes(p.code) ? ' (no disponible por ahora)' : ''}
            </option>
          ))}
        </select>
      </label>
      {blocked.length > 0 && (
        <p className="small muted">Por ahora este sorteo no está disponible en: {blocked.map((p) => p.name).join(', ')}.</p>
      )}
    </>
  );
}
