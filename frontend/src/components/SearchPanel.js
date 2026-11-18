import { useState } from 'react';
import { api, money, dateTime, numbersLabel } from '../api';

const orderLabel = {
  pending: 'Pendiente', approved: 'Pagada', manual: 'Manual', needs_review: 'Revisar',
  refunded: 'Reintegrada', charged_back: 'Contracargo',
};
const freeLabel = { confirmed: 'Gratuita confirmada', void: 'Gratuita anulada' };
const eventLabel = { ...orderLabel, approved: 'Pago acreditado', manual: 'Venta manual' };

// Buscador del panel: por número exacto, DNI, email o nombre. Muestra la "ficha" de cada compra.
export default function SearchPanel({ raffleId }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState({});

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHistory({});
    try {
      setRes(await api(`/admin/raffles/${raffleId}/search?q=${encodeURIComponent(q)}`, { auth: true }));
    } catch (err) {
      setRes(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (id) => {
    if (history[id]) return setHistory(({ [id]: _, ...rest }) => rest);
    try {
      const data = await api(`/admin/orders/${id}/history`, { auth: true });
      setHistory((h) => ({ ...h, [id]: data }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card search-panel">
      <h3>Buscar</h3>
      <form className="row" onSubmit={submit}>
        <label className="grow">Número, DNI, email o nombre
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: 100007 · 30111222 · ana@mail.com · Gómez" />
        </label>
        <button className="btn" disabled={busy || q.trim().length < 3}>{busy ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {error && <p className="alert">{error}</p>}

      {res && res.type === 'number' && (
        <p className="mt">
          {res.match
            ? <>Número <strong>{res.query}</strong>: <strong>{res.match.status === 'valid' ? 'válido' : 'anulado'}</strong>
                {res.match.status === 'void' && <> · {res.match.voidReason || 'sin motivo'}{res.match.voidedAt && ` · ${dateTime(res.match.voidedAt)}`}</>}
                {res.match.source === 'free' ? ' · participación gratuita' : ' · compra'}</>
            : <>No hay un número {res.query} en este sorteo.</>}
        </p>
      )}
      {res && res.type !== 'number' && res.results.length === 0 && <p className="mt muted">Sin resultados.</p>}
      {res?.truncated && <p className="small muted">Hay más de 50 resultados: afiná la búsqueda.</p>}

      {res?.results.map((r) => r.kind === 'free' ? (
        <article className="ficha" key={`f-${r.id}`}>
          <div className="row between">
            <strong>{r.name}</strong>
            <span className={`status free-${r.status}`}>{freeLabel[r.status]}</span>
          </div>
          <div className="small muted">DNI {r.dni} · {r.email}</div>
          <div>Número: <strong>{r.number}</strong> · confirmada el {dateTime(r.confirmedAt)}</div>
        </article>
      ) : (
        <article className="ficha" key={r.id}>
          <div className="row between">
            <strong>{r.buyerName}</strong>
            <span className={`status o-${r.status}`}>{orderLabel[r.status] || r.status}</span>
          </div>
          <div className="small muted">DNI {r.buyerDni} · {r.buyerEmail} · {r.buyerPhone}</div>
          <div>{r.courseTitle} · {r.chances} chances · {money(Number(r.amount))} · {dateTime(r.createdAt)}</div>
          <div className={r.voidedAt ? 'voided' : ''}>Números: <strong>{numbersLabel(r)}</strong></div>
          {r.voidedAt && <div className="small muted">Anulada el {dateTime(r.voidedAt)} · {r.voidReason}</div>}
          <div className="small">
            N° de operación de Mercado Pago: {r.mpPaymentId ? <strong>{r.mpPaymentId}</strong> : <span className="muted">— (venta manual o sin pago)</span>}
            {r.mpStatusDetail && <span className="muted"> · {r.mpStatusDetail}</span>}
          </div>
          <button type="button" className="linklike small" onClick={() => toggleHistory(r.id)}>{history[r.id] ? 'Ocultar historial' : 'Historial'}</button>
          {history[r.id] && (
            <ul className="history small">
              {history[r.id].events.map((e) => (
                <li key={e.id}><strong>{eventLabel[e.status] || e.status}</strong> · {dateTime(e.createdAt)}{e.detail && e.detail !== eventLabel[e.status] && <div className="muted">{e.detail}</div>}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
