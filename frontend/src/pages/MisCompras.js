import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, dateTime, goTo, numbersLabel, DEMO } from '../api';

// "Mis compras" sin contraseña: el comprador pide un link por email y con él ve sus compras.
export default function MisCompras() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token'));
  const [purchases, setPurchases] = useState(null);
  const [error, setError] = useState(null);

  // El token sale de la URL apenas se lee: no queda en el historial ni se comparte sin querer
  useEffect(() => {
    if (params.get('token')) navigate('/mis-compras', { replace: true });
  }, [params, navigate]);

  useEffect(() => {
    if (!token) return;
    setPurchases(null);
    setError(null);
    api('/my-purchases', { token }).then(setPurchases).catch((e) => {
      setError(e.message);
      setToken(null);
    });
  }, [token]);

  if (!token) return <RequestLink expired={error} onDemoToken={setToken} />;
  if (!purchases) return <div className="container narrow"><p className="muted">Cargando tus compras…</p></div>;

  return (
    <div className="container narrow">
      <h2 className="mt">Mis compras</h2>
      {purchases.map((p) => <Purchase key={p.id} p={p} />)}
      <button type="button" className="linklike small" onClick={() => { setToken(null); setPurchases(null); }}>Salir</button>
    </div>
  );
}

function Purchase({ p }) {
  const [state, setState] = useState(null);
  async function download() {
    setState('loading');
    try {
      const { url } = await api(`/orders/${p.id}/download-link`, { method: 'POST' });
      setState(null);
      goTo(url);
    } catch (e) {
      setState(e.message);
    }
  }
  return (
    <div className="card purchase">
      <div className="small muted">{p.raffle?.title} · {p.raffle?.prize}</div>
      <div className="purchase-numbers">{numbersLabel(p)}</div>
      <div className="small">{p.chances} chances{p.double ? ' (con "Duplicá")' : ''} · {money(p.amount)}</div>
      <div className="small muted mt-sm">Sorteo: {dateTime(p.raffle?.drawDate)}</div>
      <div className="mt-sm"><strong>{p.courseTitle}</strong></div>
      <div className="row mt-sm">
        {p.hasCourse && (
          <button type="button" className="btn btn-sm" onClick={download} disabled={state === 'loading'}>
            {state === 'loading' ? 'Preparando…' : 'Descargar el curso'}
          </button>
        )}
        <Link to={`/compra/${p.id}`} className="btn btn-sm btn-ghost">Ver comprobante</Link>
        {p.raffle?.youtubeUrl && <a href={p.raffle.youtubeUrl} className="btn btn-sm btn-ghost" target="_blank" rel="noreferrer">Sorteo en vivo ▶</a>}
      </div>
      {state && state !== 'loading' && <p className="alert small mt-sm">{state}</p>}
    </div>
  );
}

function RequestLink({ expired, onDemoToken }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState(null); // null | 'loading' | 'sent'
  const [error, setError] = useState(null);
  const [demoToken, setDemoToken] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setState('loading');
    setError(null);
    try {
      const res = await api('/my-purchases/link', { method: 'POST', body: { email } });
      setDemoToken(res.demoToken || null);
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState(null);
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <h2>Mis compras</h2>
        <p className="muted">Ingresá el email con el que compraste y te mandamos un link para ver tus números y descargar tus cursos. No hace falta contraseña.</p>
        {expired && <p className="alert small">{expired}</p>}
        {state === 'sent' ? (
          <div className="ok">
            <strong>Listo.</strong> Si hay compras con ese email, te enviamos el link. Revisá tu bandeja de entrada (y la carpeta de spam). Vence en 30 minutos.
            {DEMO && demoToken && (
              <div className="mt-sm"><button type="button" className="btn btn-sm" onClick={() => onDemoToken(demoToken)}>Abrir el link (demo)</button></div>
            )}
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="mc-email">Email</label>
            <input id="mc-email" type="email" required autoComplete="email" inputMode="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="alert small mt-sm">{error}</p>}
            <button type="submit" className="btn btn-lg btn-block mt" disabled={state === 'loading'}>
              {state === 'loading' ? 'Enviando…' : 'Enviarme el link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
