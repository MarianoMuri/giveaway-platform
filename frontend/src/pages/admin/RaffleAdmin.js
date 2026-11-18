import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, money, DEMO, numbersLabel } from '../../api';
import PackEditor from '../../components/PackEditor';
import SalesProgress from '../../components/SalesProgress';

const orderLabel = {
  pending: 'Pendiente', approved: 'Pagada', manual: 'Manual',
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
  const emptyManual = { chances: '', courseId: '', amount: '', name: '', phone: '', dni: '', email: '' };
  const [manual, setManual] = useState(emptyManual);
  const { data: courses } = useApi('/admin/courses', { auth: true });
  const [winnerInput, setWinnerInput] = useState('');
  const [winner, setWinner] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [csvText, setCsvText] = useState(null);
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

  const setM = (k) => (e) => setManual({ ...manual, [k]: e.target.value });

  const setStatus = (status) =>
    run(() => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { status } }), 'Estado actualizado');

  const sellManual = (e) => {
    e.preventDefault();
    let order;
    run(
      async () => {
        order = await api('/admin/orders/manual', {
          method: 'POST',
          auth: true,
          body: {
            raffleId: raffle.id,
            chances: Number(manual.chances),
            courseId: Number(manual.courseId),
            amount: Number(manual.amount),
            buyer: { name: manual.name, phone: manual.phone, dni: manual.dni, email: manual.email },
          },
        });
      },
      'Venta registrada'
    ).then((ok) => {
      if (!ok) return;
      setMsg({ type: 'ok', text: `Venta registrada: números ${numbersLabel(order)}` });
      setManual(emptyManual);
    });
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


  return (
    <div className="container">
      <Link to="/admin" className="small">← Todos los sorteos</Link>
      <div className="row between mt-sm">
        <div>
          <h1>{raffle.title}</h1>
          <p className="muted">{raffle.prize}</p>
        </div>
        <div className="row">
          {raffle.status === 'draft' && <button className="btn" onClick={() => setStatus('active')}>Publicar y abrir venta</button>}
          {raffle.status === 'active' && <button className="btn btn-ghost" onClick={() => setStatus('closed')}>Cerrar venta</button>}
          {raffle.status === 'closed' && <button className="btn btn-ghost" onClick={() => setStatus('active')}>Reabrir venta</button>}
          {raffle.status !== 'draft' && <Link className="btn btn-ghost" to={`/sorteo/${id}`} target="_blank">Ver página</Link>}
        </div>
      </div>

      {msg && <p className={msg.type}>{msg.text}</p>}

      <div className="stats">
        <div className="card stat"><span>Recaudado</span><strong>{money(stats?.revenue || 0)}</strong></div>
        <div className="card stat"><span>Chances vendidas</span><strong>{(stats?.chancesSold || 0).toLocaleString('es-AR')}</strong></div>
        <div className="card stat"><span>Compras</span><strong>{stats?.purchases || 0}</strong></div>
        <div className="card stat"><span>Pendientes de pago</span><strong>{stats?.pending || 0}</strong></div>
        {stats?.review > 0 && <div className="card stat"><span>Para revisar</span><strong className="gold">{stats.review}</strong></div>}
      </div>
      {raffle.chancesGoal && <SalesProgress raffle={{ ...raffle, chancesSold: stats?.chancesSold || 0 }} />}

      <PackEditor raffleId={id} />

      <div className="two-col">
        <form className="card" onSubmit={sellManual}>
          <h3>Venta manual</h3>
          <p className="small muted">Para ventas en efectivo o por transferencia. Los números se asignan en el acto.</p>
          <div className="row">
            <label style={{ flex: 1 }}>Chances<input required type="number" min="1" value={manual.chances} onChange={setM('chances')} /></label>
            <label style={{ flex: 1 }}>Monto cobrado ($)<input required type="number" min="0" value={manual.amount} onChange={setM('amount')} /></label>
          </div>
          <label>Curso
            <select required value={manual.courseId} onChange={setM('courseId')}>
              <option value="">Elegí el curso</option>
              {(courses || []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.active ? '' : ' (inactivo)'}</option>)}
            </select>
          </label>
          <label>Nombre y apellido<input required value={manual.name} onChange={setM('name')} /></label>
          <label>DNI<input required inputMode="numeric" value={manual.dni} onChange={setM('dni')} /></label>
          <label>Teléfono<input value={manual.phone} onChange={setM('phone')} /></label>
          <label>Email<input type="email" value={manual.email} onChange={setM('email')} /></label>
          <button className="btn btn-block">Registrar venta</button>
        </form>

        <form className="card" onSubmit={drawWinner}>
          <h3>Número ganador</h3>
          {raffle.winnerNumber && <p>Ganador cargado: <strong className="gold">{raffle.winnerNumber}</strong></p>}
          <label>Número que salió en el vivo<input required type="number" min="100000" value={winnerInput} onChange={(e) => { setWinnerInput(e.target.value); setConfirming(false); }} /></label>
          {confirming && <p className="alert small">¿Confirmás el {winnerInput} como ganador? El sorteo pasa a "Sorteado".</p>}
          <button className="btn btn-block">{confirming ? `Sí, confirmar el ${winnerInput}` : 'Cargar ganador'}</button>
          {winner && (
            <div className="ticket mt">
              <div className="small muted">Ganador del número {winner.number}</div>
              <div><strong>{winner.winner.name}</strong></div>
              <div>DNI {winner.winner.dni}</div>
              <div>{winner.winner.phone}</div>
              <div>{winner.winner.email}</div>
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
          <thead><tr><th>Fecha</th><th>Comprador</th><th>DNI</th><th>Teléfono</th><th>Curso</th><th>Números</th><th>Monto</th><th>Estado</th><th>Pago MP</th></tr></thead>
          <tbody>
            {(orders || []).map((o) => (
              <tr key={o.id}>
                <td className="nowrap">{new Date(o.createdAt).toLocaleString('es-AR')}</td>
                <td>{o.buyerName}<div className="small muted">{o.buyerEmail}</div></td>
                <td>{o.buyerDni}</td>
                <td>{o.buyerPhone}</td>
                <td>{o.courseTitle}</td>
                <td className="nowrap">{numbersLabel(o)}<div className="small muted">{o.chances} chances{o.double ? ' (Duplicá)' : ''}</div></td>
                <td>{money(o.amount)}</td>
                <td><span className={`status o-${o.status}`}>{orderLabel[o.status]}</span>{o.mpStatusDetail && o.status === 'needs_review' && <div className="small muted">{o.mpStatusDetail}</div>}</td>
                <td className="small">{o.mpPaymentId || '-'}</td>
              </tr>
            ))}
            {orders && orders.length === 0 && <tr><td colSpan="9" className="muted">Sin compras.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
