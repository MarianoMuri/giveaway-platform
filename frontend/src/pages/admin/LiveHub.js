import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks';
import { getRole, setToken } from '../../api';

// Entrada aparte para el sorteo en vivo: no muestra recaudación ni datos de compradores, así que se puede
// tener a la vista (o compartir esta pestaña) durante la transmisión sin exponer el panel completo.
export default function LiveHub() {
  const nav = useNavigate();
  const { data: raffles, error } = useApi('/admin/raffles', { auth: true });
  const onlyLive = getRole() === 'live';
  const list = (raffles || []).filter((r) => r.status !== 'draft');

  const state = (r) => {
    if (r.status === 'drawn') return 'Ya tiene ganador (se puede repetir con un motivo)';
    const closedByDate = r.salesCloseAt && new Date(r.salesCloseAt) <= new Date();
    return r.status === 'active' && !closedByDate ? 'La venta sigue abierta: cerrala antes de sortear' : 'Lista para sortear';
  };

  return (
    <div className="container">
      <h1>Sorteo en vivo</h1>
      {onlyLive && <button className="btn btn-ghost btn-sm" onClick={() => { setToken(null); nav('/admin/login'); }}>Salir</button>}
      <p className="muted">Elegí el sorteo. Se abre en pantalla completa, sin datos del panel.</p>
      {error && <p className="alert">{error.message || 'No se pudo cargar la lista.'}</p>}
      <div>
        {list.map((r) => (
          <section key={r.id} className="card">
            <h3>{r.title}</h3>
            <p className="muted">{r.prize}</p>
            <p className="small">{state(r)}</p>
            <Link to={`/admin/sorteo/${r.id}/en-vivo`} className="btn btn-lg">Abrir sorteo en vivo</Link>
          </section>
        ))}
      </div>
      {raffles && list.length === 0 && <p className="muted">No hay sorteos publicados para sortear.</p>}
    </div>
  );
}
