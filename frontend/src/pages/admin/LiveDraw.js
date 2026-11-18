import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api } from '../../api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rollMs = 4500; // dura la animación; el número ya lo decidió el servidor

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
  const { data: stats, reload: reloadStats } = useApi(`/admin/raffles/${id}/stats`, { auth: true });
  const [phase, setPhase] = useState('idle'); // idle | rolling | done
  const [digits, setDigits] = useState(['?', '?', '?', '?', '?', '?']);
  const [locked, setLocked] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false); // pidiendo el motivo para repetir
  const [reason, setReason] = useState('');
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
  const participants = (stats?.chancesSold || 0) + (stats?.freeEntries || 0);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const run = async () => {
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
        sleep(reduceMotion ? 0 : rollMs),
      ]);
      const final = String(res.number).padStart(6, '0').split('');
      // los dígitos se van fijando de a uno, de izquierda a derecha
      for (let i = 1; i <= final.length; i += 1) {
        setDigits((d) => final.map((x, k) => (k < i ? x : d[k])));
        setLocked(i);
        if (!reduceMotion) await sleep(650);
      }
      clearInterval(timer.current);
      setDigits(final);
      setResult(res);
      setPhase('done');
      setAsking(false);
      setReason('');
      reload();
      reloadStats();
    } catch (e) {
      clearInterval(timer.current);
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
      <p className="live-count">{participants.toLocaleString('es-AR')} chances participan</p>

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

      {error && <p className="alert live-msg">{error}</p>}
      {saleOpen && <p className="alert live-msg">La venta sigue abierta. Cerrala (con fecha o a mano) antes de sortear.</p>}

      {!saleOpen && phase !== 'rolling' && (
        <div className="live-actions">
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
