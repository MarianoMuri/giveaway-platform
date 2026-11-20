import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, getRole, setToken } from '../../api';

// Entrada aparte para el sorteo en vivo: no muestra recaudación ni datos de compradores, así que se puede
// tener a la vista (o compartir esta pestaña) durante la transmisión sin exponer el panel completo.
// El administrador habilita o deshabilita cada sorteo; los deshabilitados quedan abajo, en gris y sin botón.
export default function LiveHub() {
  const nav = useNavigate();
  const { data: raffles, error, reload } = useApi('/admin/raffles', { auth: true });
  const [msg, setMsg] = useState(null);
  const onlyLive = getRole() === 'live';
  const enabled = (r) => r.liveEnabled !== false;
  // Habilitados arriba (el más nuevo primero); deshabilitados al final. sort() es estable: se conserva el orden por fecha.
  const list = (raffles || []).filter((r) => r.status !== 'draft').sort((a, b) => Number(enabled(b)) - Number(enabled(a)));

  const state = (r) => {
    if (r.status === 'drawn') return 'Ya tiene ganador (se puede repetir con un motivo)';
    const closedByDate = r.salesCloseAt && new Date(r.salesCloseAt) <= new Date();
    return r.status === 'active' && !closedByDate ? 'La venta sigue abierta: cerrala antes de sortear' : 'Lista para sortear';
  };

  async function toggle(r) {
    setMsg(null);
    try {
      await api(`/admin/raffles/${r.id}`, { method: 'PATCH', auth: true, body: { liveEnabled: !enabled(r) } });
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="container">
      <h1>Sorteo en vivo</h1>
      {onlyLive && <button className="btn btn-ghost btn-sm" onClick={() => { setToken(null); nav('/admin/login'); }}>Salir</button>}
      <p className="muted">Elegí el sorteo. Se abre en pantalla completa, sin datos del panel.</p>
      {error && <p className="alert">{error.message || 'No se pudo cargar la lista.'}</p>}
      {msg && <p className="alert">{msg}</p>}
      <div>
        {list.map((r) => (
          <section key={r.id} className="card" style={enabled(r) ? undefined : { opacity: 0.55 }}>
            <h3>{r.title}</h3>
            <p className="muted">{r.prize}</p>
            <p className="small">{enabled(r) ? state(r) : 'Deshabilitado: no se puede abrir'}</p>
            {enabled(r)
              ? <Link to={`/admin/sorteo/${r.id}/en-vivo`} className="btn btn-lg">Abrir sorteo en vivo</Link>
              : <button className="btn btn-lg" disabled style={{ filter: 'grayscale(1)', cursor: 'not-allowed' }}>Abrir sorteo en vivo</button>}
            {!onlyLive && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: '0.75rem' }} onClick={() => toggle(r)}>
                {enabled(r) ? 'Deshabilitar' : 'Habilitar'}
              </button>
            )}
          </section>
        ))}
      </div>
      {raffles && list.length === 0 && <p className="muted">No hay sorteos publicados para sortear.</p>}
    </div>
  );
}
