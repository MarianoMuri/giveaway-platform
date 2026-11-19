import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, dateTime, goTo, numbersLabel, DEMO } from '../api';
import Turnstile from '../components/Turnstile';

// "Mis compras" sin contraseña: el comprador pide un link por email y con él ve sus compras.
export default function MisCompras() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token'));
  const [purchases, setPurchases] = useState(null);
  const [error, setError] = useState(null);
  const [byDni, setByDni] = useState(null); // resultado de entrar con DNI: { dni, name, purchases, freeEntries }

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

  if (byDni) return <DniResult data={byDni} onExit={() => setByDni(null)} />;
  if (!token) return <DniLogin expired={error} onResult={setByDni} onDemoToken={setToken} />;
  if (!purchases) return <div className="container narrow"><p className="muted">Cargando tus compras…</p></div>;

  return (
    <div className="container narrow">
      <h2 className="mt">Mis compras</h2>
      {purchases.map((p) => <Purchase key={p.id} p={p} />)}
      <button type="button" className="linklike small" onClick={() => { setToken(null); setPurchases(null); }}>Salir</button>
    </div>
  );
}

function Purchase({ p, dni }) {
  const [state, setState] = useState(null);
  const [askEmail, setAskEmail] = useState(false);
  const [email, setEmail] = useState('');
  async function download(e) {
    if (e) e.preventDefault();
    if (dni && !askEmail) { setAskEmail(true); return; }
    setState('loading');
    try {
      const { url } = dni
        ? await api('/my-purchases/download', { method: 'POST', body: { dni, email, orderId: p.id } })
        : await api(`/orders/${p.id}/download-link`, { method: 'POST' });
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
      {dni && askEmail && (
        <form className="mt-sm" onSubmit={download}>
          <label htmlFor={`dl-${p.id}`} className="small">Para descargar, escribí el email con el que compraste</label>
          <input id={`dl-${p.id}`} type="email" required autoComplete="email" inputMode="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </form>
      )}
      {state && state !== 'loading' && <p className="alert small mt-sm">{state}</p>}
    </div>
  );
}

// Resultado de entrar con el DNI: números sin mail. Descargar pide además el email.
function DniResult({ data, onExit }) {
  const { dni, name, purchases, freeEntries } = data;
  const empty = !purchases.length && !freeEntries.length;
  return (
    <div className="container narrow">
      <h2 className="mt">{name ? `Hola, ${name}` : 'Mis compras'}</h2>
      {empty && (
        <div className="card">
          <p><strong>No encontramos compras ni participaciones con ese DNI.</strong></p>
          <p className="muted small">Revisá que esté bien escrito. Si pagaste hace unos minutos, el pago puede tardar en acreditarse: probá de nuevo en un rato.</p>
        </div>
      )}
      {purchases.map((p) => <Purchase key={p.id} p={p} dni={dni} />)}
      {freeEntries.map((f) => (
        <div key={f.id} className="card purchase">
          <div className="small muted">{f.raffle?.title} · {f.raffle?.prize}</div>
          <div className="purchase-numbers">{f.number}</div>
          <div className="small">Participación gratuita (1 chance)</div>
          <div className="small muted mt-sm">Sorteo: {dateTime(f.raffle?.drawDate)}</div>
          {f.raffle?.youtubeUrl && <div className="mt-sm"><a href={f.raffle.youtubeUrl} className="btn btn-sm btn-ghost" target="_blank" rel="noreferrer">Sorteo en vivo ▶</a></div>}
        </div>
      ))}
      <button type="button" className="linklike small" onClick={onExit}>Salir</button>
    </div>
  );
}

function DniLogin({ expired, onResult, onDemoToken }) {
  const [dni, setDni] = useState('');
  const [captchaToken, setCaptchaToken] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [showMail, setShowMail] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setState('loading');
    setError(null);
    try {
      const res = await api('/my-purchases/by-dni', { method: 'POST', body: { dni, captchaToken } });
      onResult({ ...res, dni: dni.replace(/\D/g, '') });
    } catch (err) {
      setError(err.message);
      setState(null);
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <h2>Mis compras</h2>
        <p className="muted">Ingresá tu DNI y mirá tus números. No hace falta contraseña ni email.</p>
        {expired && <p className="alert small">{expired}</p>}
        <form onSubmit={submit}>
          <label htmlFor="mc-dni">DNI</label>
          <input id="mc-dni" required inputMode="numeric" autoComplete="off" placeholder="Solo números" value={dni} onChange={(e) => setDni(e.target.value)} />
          <Turnstile onToken={setCaptchaToken} />
          {error && <p className="alert small mt-sm">{error}</p>}
          <button type="submit" className="btn btn-lg btn-block mt" disabled={state === 'loading'}>
            {state === 'loading' ? 'Buscando…' : 'Ver mis números'}
          </button>
        </form>
        <p className="small mt">
          <button type="button" className="linklike" onClick={() => setShowMail((v) => !v)}>
            {showMail ? 'Ocultar' : 'Prefiero que me manden un link por email'}
          </button>
        </p>
      </div>
      {showMail && <RequestLink expired={null} onDemoToken={onDemoToken} />}
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
