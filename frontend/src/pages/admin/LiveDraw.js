import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api } from '../../api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_SECS = 20; // duración total de la animación; el número ya lo decidió el servidor
const MIN_SECS = 3;
const MAX_SECS = 120;
const clampSecs = (n) => Math.min(MAX_SECS, Math.max(MIN_SECS, Math.round(Number(n)) || DEFAULT_SECS));
const loadSecs = () => {
  try { return clampSecs(localStorage.getItem('liveDrawSecs') || DEFAULT_SECS); } catch (e) { return DEFAULT_SECS; }
};

// "Luis Díaz" -> "Luis D.": en la transmisión no se muestran datos personales completos
const maskName = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
};

// Pantalla completa para transmitir el sorteo en vivo. El azar lo hace el servidor (crypto) entre los
// números válidos; la animación es solo ambientación y se detiene en el número que ya salió.
export default function LiveDraw() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: raffles, reload } = useApi('/admin/raffles', { auth: true });
  const [phase, setPhase] = useState('idle'); // idle | rolling | done
  const [digits, setDigits] = useState(['?', '?', '?', '?', '?', '?']);
  const [locked, setLocked] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false); // pidiendo el motivo para repetir
  const [reason, setReason] = useState('');
  const [secs, setSecs] = useState(loadSecs); // segundos hasta que aparecen todos los números
  const [left, setLeft] = useState(0); // cuenta regresiva mientras gira
  const timer = useRef(null);

  const raffle = (raffles || []).find((r) => String(r.id) === id);
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) nav(`/admin/sorteo/${id}`); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, nav]);

  if (!raffle) return <div className="live"><p>Cargando…</p></div>;

  const closedByDate = raffle.salesCloseAt && new Date(raffle.salesCloseAt) <= new Date();
  const saleOpen = raffle.status === 'active' && !closedByDate;
  const redo = raffle.status === 'drawn';
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const changeSecs = (v) => {
    const n = clampSecs(v);
    setSecs(n);
    try { localStorage.setItem('liveDrawSecs', String(n)); } catch (e) { /* sin almacenamiento: solo vale para esta vez */ }
  };

  const run = async () => {
    // el tiempo total se reparte en 6 tramos iguales: gira todo, y luego se fija un dígito por tramo
    const stepMs = reduceMotion ? 0 : (secs * 1000) / 6;
    const startedAt = Date.now();
    setLeft(secs);
    const countdown = setInterval(() => setLeft(Math.max(0, Math.ceil(secs - (Date.now() - startedAt) / 1000))), 250);
    setError(null);
    setResult(null);
    setPhase('rolling');
    setLocked(0);
    if (!reduceMotion) {
      timer.current = setInterval(() => setDigits(Array.from({ length: 6 }, () => String(Math.floor(Math.random() * 10)))), 70);
    }
    try {
      const [res] = await Promise.all([
        api(`/admin/raffles/${id}/draw`, { method: 'POST', auth: true, body: redo ? { reason } : {} }),
        sleep(stepMs),
      ]);
      const final = String(res.number).padStart(6, '0').split('');
      // los dígitos se van fijando de a uno, de izquierda a derecha
      for (let i = 1; i <= final.length; i += 1) {
        setDigits((d) => final.map((x, k) => (k < i ? x : d[k])));
        setLocked(i);
        if (i < final.length) await sleep(stepMs);
      }
      clearInterval(timer.current);
      clearInterval(countdown);
      setDigits(final);
      setResult(res);
      setPhase('done');
      setAsking(false);
      setReason('');
      reload();
    } catch (e) {
      clearInterval(timer.current);
      clearInterval(countdown);
      setDigits(['?', '?', '?', '?', '?', '?']);
      setPhase('idle');
      setError(e.message);
    }
  };

  const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  return (
    <div className="live">
      <div className="live-top">
        <Link to={`/admin/sorteo/${id}`} className="small">← Salir</Link>
        <button className="btn btn-ghost btn-sm" onClick={fullscreen}>Pantalla completa</button>
      </div>
      <p className="live-prize">🚗 {raffle.prize}</p>
      <h1 className="live-title">{raffle.title}</h1>

      <div className={`live-digits ${phase}`} aria-live="polite">
        {digits.map((d, i) => <span key={i} className={`live-digit ${i < locked ? 'locked' : ''}`}>{d}</span>)}
      </div>

      {phase === 'done' && result && (
        <div className="live-winner">
          <div className="live-congrats">¡Ganador!</div>
          <div className="live-name">{maskName(result.winner.name)}</div>
          <div className="small">{result.winner.source === 'free' ? 'Participación gratuita' : 'Compra'} · número {result.number}</div>
        </div>
      )}

      {phase === 'rolling' && !reduceMotion && <p className="live-count" aria-live="off">Faltan {left} s</p>}

      {error && <p className="alert live-msg">{error}</p>}
      {saleOpen && <p className="alert live-msg">La venta sigue abierta. Cerrala (con fecha o a mano) antes de sortear.</p>}

      {!saleOpen && phase !== 'rolling' && (
        <div className="live-actions">
          {(!redo || asking) && (
            <label className="live-secs">Duración del sorteo (segundos)
              <span className="live-secs-ctl">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeSecs(secs - 5)} aria-label="Menos segundos">−</button>
                <input type="number" min={MIN_SECS} max={MAX_SECS} value={secs} onChange={(e) => setSecs(e.target.value === '' ? '' : Number(e.target.value))} onBlur={() => changeSecs(secs)} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeSecs(secs + 5)} aria-label="Más segundos">+</button>
              </span>
            </label>
          )}
          {redo && !asking && phase !== 'done' && <p className="live-msg">Ya hay un ganador: <strong>{raffle.winnerNumber}</strong>.</p>}
          {redo && asking && (
            <label className="live-reason">Motivo para repetir el sorteo (queda registrado)
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: el ganador no respondió en 48 horas" />
            </label>
          )}
          {!redo && <button className="btn live-btn" onClick={run}>SORTEAR</button>}
          {redo && !asking && <button className="btn btn-ghost" onClick={() => setAsking(true)}>Repetir sorteo</button>}
          {redo && asking && <button className="btn live-btn" onClick={run} disabled={reason.trim().length < 10}>SORTEAR DE NUEVO</button>}
        </div>
      )}
    </div>
  );
}
