import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, money, DEMO } from '../../api';
import { PromoEditor, cleanPromos } from '../../components/Promos';
import PackEditor from '../../components/PackEditor';

const orderLabel = {
  pending: 'Pendiente', approved: 'Pagada', manual: 'Manual', expired: 'Vencida',
  rejected: 'Rechazada', needs_review: 'Revisar',
};

export default function RaffleAdmin() {
  const { id } = useParams();
  const { data: raffles, reload: reloadRaffles } = useApi('/admin/raffles', { auth: true });
  const { data: stats, reload: reloadStats } = useApi(`/admin/raffles/${id}/stats`, { auth: true, interval: 20000 });
  const [filter, setFilter] = useState('');
  const { data: orders, reload: reloadOrders } = useApi(
    `/admin/orders?raffleId=${id}${filter ? `&status=${filter}` : ''}`,
    { auth: true }
  );
  const [manual, setManual] = useState({ numbers: '', name: '', phone: '', dni: '' });
  const [winnerInput, setWinnerInput] = useState('');
  const [winner, setWinner] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [csvText, setCsvText] = useState(null);
  const [promoEdit, setPromoEdit] = useState(null);
  const [msg, setMsg] = useState(null);

  const raffle = (raffles || []).find((r) => String(r.id) === id);
  if (!raffle) return <div className="container"><p className="muted">Cargando…</p></div>;

  const refresh = () => { reloadRaffles(); reloadStats(); reloadOrders(); };
  const run = async (fn, ok) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ type: 'ok', text: ok });
      refresh();
      return true;
    } catch (e) {
      setMsg({ type: 'alert', text: e.message });
      return false;
    }
  };

  const setStatus = (status) =>
    run(() => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { status } }), 'Estado actualizado');

  const sellManual = (e) => {
    e.preventDefault();
    const numbers = manual.numbers.split(/[\s,;]+/).map(Number).filter(Boolean);
    run(
      () => api('/admin/orders/manual', { method: 'POST', auth: true, body: { raffleId: raffle.id, numbers, buyer: manual } }),
      `Venta registrada: ${numbers.join(', ')}`
    ).then((ok) => ok && setManual({ numbers: '', name: '', phone: '', dni: '' }));
  };

  const drawWinner = async (e) => {
    e.preventDefault();
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    try {
      setWinner(await api(`/admin/raffles/${id}/winner`, { method: 'POST', auth: true, body: { number: Number(winnerInput) } }));
      refresh();
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    }
  };

  const exportCsv = async () => {
    const res = await api(`/admin/raffles/${id}/export.csv`, { auth: true, raw: true });
    if (DEMO) return setCsvText(await res.text()); // el visor de la demo no permite descargas
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `compradores-sorteo-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = stats?.byStatus || {};
  const sold = s.sold || 0;
  const pct = Math.round((sold / raffle.totalNumbers) * 100);

  return (
    <div className="container">
      <Link to="/admin" className="small">← Todos los sorteos</Link>
      <div className="row between mt-sm">
        <div>
          <h1>{raffle.title}</h1>
          <p className="muted">{raffle.prize} · 1 número {money(raffle.pricePerNumber)}{(raffle.promos || []).map((p) => ` · ${p.qty} por ${money(p.price)}`).join('')}{' '}
            <button className="linklike" onClick={() => setPromoEdit(promoEdit ? null : (raffle.promos || []))}>{promoEdit ? 'cancelar' : 'editar promos'}</button>
          </p>
          {promoEdit && (
            <div className="card">
              <PromoEditor value={promoEdit} onChange={setPromoEdit} />
              <button className="btn btn-sm mt-sm" onClick={() => run(() => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { promos: cleanPromos(promoEdit) } }), 'Promos actualizadas').then((ok) => ok && setPromoEdit(null))}>Guardar promos</button>
            </div>
          )}
        </div>
        <div className="row">
          {raffle.status === 'draft' && <button className="btn" onClick={() => setStatus('active')}>Publicar y abrir venta</button>}
          {raffle.status === 'active' && <button className="btn btn-ghost" onClick={() => setStatus('closed')}>Cerrar venta</button>}
          {raffle.status === 'closed' && <button className="btn btn-ghost" onClick={() => setStatus('active')}>Reabrir venta</button>}
          {raffle.status !== 'draft' && <Link className="btn btn-ghost" to={`/sorteo/${id}`} target="_blank">Ver página</Link>}
        </div>
      </div>

      {msg && <p className={msg.type}>{msg.text}</p>}

      <PackEditor raffleId={id} />

      <div className="stats">
        <div className="card stat"><span>Recaudado</span><strong>{money(stats?.revenue || 0)}</strong></div>
        <div className="card stat"><span>Vendidos</span><strong>{sold} <small className="muted">/ {raffle.totalNumbers}</small></strong></div>
        <div className="card stat"><span>Reservados ahora</span><strong>{s.reserved || 0}</strong></div>
        <div className="card stat"><span>Libres</span><strong>{s.available || 0}</strong></div>
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      <p className="small muted">{pct}% vendido</p>

      <div className="two-col">
        <form className="card" onSubmit={sellManual}>
          <h3>Venta manual</h3>
          <p className="small muted">Para ventas en efectivo o por transferencia.</p>
          <label>Números (separados por coma)<input required value={manual.numbers} onChange={(e) => setManual({ ...manual, numbers: e.target.value })} placeholder="12, 45, 300" /></label>
          <label>Nombre<input required value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} /></label>
          <label>Teléfono<input value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} /></label>
          <label>DNI<input value={manual.dni} onChange={(e) => setManual({ ...manual, dni: e.target.value })} /></label>
          <button className="btn btn-block">Registrar venta</button>
        </form>

        <form className="card" onSubmit={drawWinner}>
          <h3>Número ganador</h3>
          {raffle.winnerNumber && <p>Ganador cargado: <strong className="gold">{raffle.winnerNumber}</strong></p>}
          <label>Número que salió en el vivo<input required type="number" min="1" max={raffle.totalNumbers} value={winnerInput} onChange={(e) => { setWinnerInput(e.target.value); setConfirming(false); }} /></label>
          {confirming && <p className="alert small">¿Confirmás el {winnerInput} como ganador? El sorteo pasa a "Sorteado".</p>}
          <button className="btn btn-block">{confirming ? `Sí, confirmar el ${winnerInput}` : 'Cargar ganador'}</button>
          {winner && (
            <div className="ticket mt">
              {winner.sold && winner.winner ? (
                <>
                  <div className="small muted">Ganador del número {winner.number}</div>
                  <div><strong>{winner.winner.name}</strong></div>
                  <div>DNI {winner.winner.dni}</div>
                  <div>{winner.winner.phone}</div>
                  <div>{winner.winner.email}</div>
                </>
              ) : (
                <div>El número {winner.number} no fue vendido.</div>
              )}
            </div>
          )}
        </form>
      </div>

      <div className="row between mt-lg">
        <h3>Compras</h3>
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(orderLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}>Exportar a Excel</button>
        </div>
      </div>
      {csvText && (
        <div className="card mt">
          <div className="row between">
            <strong>Exportación (CSV para Excel)</strong>
            <div className="row">
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(csvText).catch(() => {})}>Copiar</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setCsvText(null)}>Cerrar</button>
            </div>
          </div>
          <p className="small muted">En la versión real se descarga como archivo. La demo no permite descargas.</p>
          <textarea readOnly rows="8" value={csvText} className="mono" />
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Comprador</th><th>DNI</th><th>Teléfono</th><th>Números</th><th>Monto</th><th>Estado</th><th>Pago MP</th></tr></thead>
          <tbody>
            {(orders || []).map((o) => (
              <tr key={o.id}>
                <td className="nowrap">{new Date(o.createdAt).toLocaleString('es-AR')}</td>
                <td>{o.buyerName}<div className="small muted">{o.buyerEmail}</div></td>
                <td>{o.buyerDni}</td>
                <td>{o.buyerPhone}</td>
                <td>{o.numbers.join(', ')}</td>
                <td>{money(o.amount)}</td>
                <td><span className={`status o-${o.status}`}>{orderLabel[o.status]}</span>{o.mpStatusDetail && o.status === 'needs_review' && <div className="small muted">{o.mpStatusDetail}</div>}</td>
                <td className="small">{o.mpPaymentId || '-'}</td>
              </tr>
            ))}
            {orders && orders.length === 0 && <tr><td colSpan="8" className="muted">Sin compras.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
