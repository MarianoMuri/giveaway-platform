import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, money, DEMO, numbersLabel, dateTime } from '../../api';
import PackEditor from '../../components/PackEditor';
import SalesProgress from '../../components/SalesProgress';

const emailLabel = { none: 'Sin email', pending: 'Pendiente', sent: 'Enviado', failed: 'Falló' };

const freeLabel = { unconfirmed: 'Sin confirmar', confirmed: 'Confirmada', void: 'Anulada' };

const orderLabel = {
  pending: 'Pendiente', approved: 'Pagada', manual: 'Manual',
  rejected: 'Rechazada', needs_review: 'Revisar',
  refunded: 'Reintegrada', charged_back: 'Contracargo',
};

const eventLabel = { ...orderLabel, approved: 'Pago acreditado', manual: 'Venta manual' };

// <input type="datetime-local"> trabaja en hora local, sin zona: se convierte desde/hacia ISO
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
  const { data: freeList, reload: reloadFree } = useApi(`/admin/raffles/${id}/free-entries`, { auth: true });
  const [history, setHistory] = useState({}); // historial de estados por compra (se carga al abrirlo)
  const [closeAt, setCloseAt] = useState(null); // null = sin tocar (se muestra el valor guardado)
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(false);
  const [winnerInput, setWinnerInput] = useState('');
  const [winner, setWinner] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [csvText, setCsvText] = useState(null);
  const [msg, setMsg] = useState(null);

  const raffle = (raffles || []).find((r) => String(r.id) === id);
  if (!raffle) return <div className="container"><p className="muted">Cargando…</p></div>;

  const refresh = () => { reloadRaffles(); reloadStats(); reloadOrders(); reloadFree(); };
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

  const toggleFree = () =>
    run(() => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { freeEntryEnabled: !raffle.freeEntryEnabled } }),
      raffle.freeEntryEnabled ? 'Participación gratuita desactivada' : 'Participación gratuita activada');
  const voidFree = (f) => {
    if (!window.confirm(`¿Anular la participación de ${f.name} (DNI ${f.dni})? Su número no se vuelve a usar.`)) return;
    run(() => api(`/admin/free-entries/${f.id}/void`, { method: 'POST', auth: true }), 'Participación anulada');
  };

  const setM = (k) => (e) => setManual({ ...manual, [k]: e.target.value });

  const toggleHistory = async (o) => {
    if (history[o.id]) return setHistory(({ [o.id]: _, ...rest }) => rest);
    try {
      setHistory((h) => ({ ...h, [o.id]: { loading: true } }));
      const data = await api(`/admin/orders/${o.id}/history`, { auth: true });
      setHistory((h) => ({ ...h, [o.id]: data }));
    } catch (e) {
      setHistory(({ [o.id]: _, ...rest }) => rest);
      setMsg({ type: 'error', text: e.message });
    }
  };

  // Reenvía el email de confirmación; permite corregir la dirección
  const resendEmail = (o) => {
    const email = window.prompt('Reenviar el email de confirmación a:', o.buyerEmail === '-' ? '' : o.buyerEmail);
    if (email === null) return;
    run(() => api(`/admin/orders/${o.id}/resend-email`, { method: 'POST', auth: true, body: { email } }), `Email reenviado a ${email}`);
  };

  const setStatus = (status) =>
    run(() => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { status } }), status === 'closed' ? 'Venta deshabilitada' : 'Estado actualizado');

  // La fecha de cierre ya pasó: para volver a vender hay que quitarla (o poner una nueva)
  const saleClosedByDate = raffle.status === 'active' && raffle.salesCloseAt && new Date(raffle.salesCloseAt) <= new Date();
  const enableSales = () => {
    if (saleClosedByDate && !window.confirm(`La fecha de cierre (${dateTime(raffle.salesCloseAt)}) ya pasó. Para habilitar la venta se va a quitar esa fecha. Podés poner una nueva después. ¿Continuar?`)) return;
    return run(
      () => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { status: 'active', ...(saleClosedByDate ? { salesCloseAt: null } : {}) } }),
      'Venta habilitada'
    );
  };

  const saveCloseAt = (e) => {
    e.preventDefault();
    const value = closeAt === null ? toLocalInput(raffle.salesCloseAt) : closeAt;
    return run(
      () => api(`/admin/raffles/${id}`, { method: 'PATCH', auth: true, body: { salesCloseAt: value ? new Date(value).toISOString() : null } }),
      value ? 'Fecha de cierre guardada' : 'Se quitó la fecha de cierre'
    ).then((ok) => ok && setCloseAt(null));
  };

  // Le pregunta a Mercado Pago por las compras sin pago registrado y carga las que faltaban
  const consult = async () => {
    setChecking(true);
    setMsg(null);
    try {
      setReadiness(await api(`/admin/raffles/${id}/readiness`, { method: 'POST', auth: true }));
      refresh();
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    } finally {
      setChecking(false);
    }
  };

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
          {raffle.status === 'active' && !saleClosedByDate && <button className="btn btn-ghost" onClick={() => setStatus('closed')}>Deshabilitar venta</button>}
          {(raffle.status === 'closed' || saleClosedByDate) && <button className="btn btn-ghost" onClick={enableSales}>Habilitar venta</button>}
          <button className="btn btn-ghost" onClick={toggleFree}>{raffle.freeEntryEnabled ? 'Desactivar participación gratuita' : 'Activar participación gratuita'}</button>
          {raffle.status !== 'draft' && <Link className="btn btn-ghost" to={`/sorteo/${id}`} target="_blank">Ver página</Link>}
        </div>
      </div>

      {raffle.status !== 'draft' && raffle.status !== 'drawn' && (
        <p className={`small ${saleClosedByDate || raffle.status === 'closed' ? 'muted' : 'ok'}`}>
          Venta: <strong>{raffle.status === 'active' && !saleClosedByDate ? 'habilitada' : 'deshabilitada'}</strong>
          {saleClosedByDate ? ` (cerró el ${dateTime(raffle.salesCloseAt)})` : ''}
        </p>
      )}

      {msg && <p className={msg.type}>{msg.text}</p>}

      <div className="stats">
        <div className="card stat"><span>Recaudado</span><strong>{money(stats?.revenue || 0)}</strong></div>
        <div className="card stat"><span>Chances vendidas</span><strong>{(stats?.chancesSold || 0).toLocaleString('es-AR')}</strong></div>
        <div className="card stat"><span>Compras</span><strong>{stats?.purchases || 0}</strong></div>
        <div className="card stat"><span>Participaciones gratuitas</span><strong>{stats?.freeEntries || 0}</strong></div>
        <div className="card stat"><span>Pendientes de pago</span><strong>{stats?.pending || 0}</strong></div>
        {stats?.reversed > 0 && <div className="card stat"><span>Anuladas (reintegro / contracargo)</span><strong>{stats.reversed}</strong></div>}
        {stats?.review > 0 && <div className="card stat"><span>Para revisar</span><strong className="gold">{stats.review}</strong></div>}
      </div>
      {stats?.winnerVoided && <p className="alert">Atención: el número ganador cargado quedó anulado por un reintegro o contracargo. Hay que sortear de nuevo.</p>}
      {raffle.chancesGoal && <SalesProgress raffle={{ ...raffle, chancesSold: stats?.chancesSold || 0 }} />}

      <PackEditor raffleId={id} />

      <section className="card readiness">
        <h3>Cierre de venta y control previo al sorteo</h3>
        <form className="row" onSubmit={saveCloseAt}>
          <label>Cierre de venta (opcional)
            <input type="datetime-local" value={closeAt === null ? toLocalInput(raffle.salesCloseAt) : closeAt} onChange={(e) => setCloseAt(e.target.value)} />
          </label>
          <button className="btn btn-ghost">Guardar fecha</button>
        </form>
        <p className="small muted">
          Al llegar esa fecha no se pueden comprar más chances ni sumar participaciones gratuitas. Las compras iniciadas antes y acreditadas después se respetan.
          {' '}{raffle.status === 'active' ? (raffle.salesCloseAt ? `La venta ${new Date(raffle.salesCloseAt) > new Date() ? 'cierra' : 'cerró'} el ${dateTime(raffle.salesCloseAt)}` : 'Sin fecha: la venta sigue abierta hasta que la cierres a mano.') : 'La venta está cerrada.'}
        </p>
        <button className="btn" type="button" onClick={consult} disabled={checking}>{checking ? 'Consultando…' : 'Consultar si están todos los clientes cargados'}</button>
        {readiness && (
          <div className="mt">
            <p className={readiness.ready ? 'ok' : 'alert'}>
              {readiness.ready ? 'Todo listo: la venta está cerrada y no queda nada pendiente. Se puede sortear.' : 'Todavía no está todo listo:'}
            </p>
            {!readiness.ready && <ul>{readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            <ul className="small">
              <li>Chances válidas: <strong>{readiness.validChances.toLocaleString('es-AR')}</strong> ({readiness.paidChances.toLocaleString('es-AR')} pagas + {readiness.freeChances.toLocaleString('es-AR')} gratuitas)</li>
              <li>Compras revisadas en Mercado Pago: {readiness.checked} · cargadas ahora que faltaban: <strong>{readiness.recovered}</strong></li>
              <li>Iniciadas sin pago (no cuentan): {readiness.noPayment + readiness.abandoned}</li>
              {readiness.unconfirmedFree > 0 && <li>Participaciones gratuitas sin confirmar el email (no cuentan, y ya no pueden confirmarse al cerrar): {readiness.unconfirmedFree}</li>}
            </ul>
            <p className="small muted">Consultado el {dateTime(readiness.checkedAt)} — si cambia algo, volvé a consultar.</p>
          </div>
        )}
      </section>

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
          {raffle.status !== 'drawn' && <p className="small muted">Se carga con la venta cerrada.</p>}
          {raffle.winnerNumber && <p>Ganador cargado: <strong className="gold">{raffle.winnerNumber}</strong></p>}
          <label>Número que salió en el vivo<input required type="number" min="100000" value={winnerInput} onChange={(e) => { setWinnerInput(e.target.value); setConfirming(false); }} /></label>
          {confirming && <p className="alert small">¿Confirmás el {winnerInput} como ganador? El sorteo pasa a "Sorteado".</p>}
          <button className="btn btn-block">{confirming ? `Sí, confirmar el ${winnerInput}` : 'Cargar ganador'}</button>
          {winner && (
            <div className="ticket mt">
              <div className="small muted">Ganador del número {winner.number}</div>
              <div><strong>{winner.winner.name}</strong></div>
              <div>DNI {winner.winner.dni}</div>
              {winner.winner.phone && <div>{winner.winner.phone}</div>}
              {winner.winner.source === 'free' && <div className="small muted">Participación gratuita: contactar por email y pedir el DNI</div>}
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
          <thead><tr><th>Fecha</th><th>Comprador</th><th>Curso</th><th>Números</th><th>Monto</th><th>Estado</th><th>Email</th><th>Pago MP</th></tr></thead>
          <tbody>
            {(orders || []).map((o) => (
              <tr key={o.id}>
                <td className="nowrap">{new Date(o.createdAt).toLocaleString('es-AR')}</td>
                <td>
                  {o.buyerName}
                  <div className="small muted">{o.buyerEmail}</div>
                  <div className="small muted">DNI {o.buyerDni} · {o.buyerPhone}</div>
                </td>
                <td>{o.courseTitle}</td>
                <td className={`nowrap${o.voidedAt ? ' voided' : ''}`}>{numbersLabel(o)}<div className="small muted">{o.chances} chances{o.double ? ' (Duplicá)' : ''}</div></td>
                <td>{money(o.amount)}</td>
                <td><span className={`status o-${o.status}`}>{orderLabel[o.status]}</span>{o.mpStatusDetail && o.status === 'needs_review' && <div className="small muted">{o.mpStatusDetail}</div>}
                  {o.voidedAt && <div className="small muted">{new Date(o.voidedAt).toLocaleString('es-AR')}<br />{o.voidReason}</div>}
                  <div><button type="button" className="linklike small" onClick={() => toggleHistory(o)}>{history[o.id] ? 'Ocultar historial' : 'Historial'}</button></div>
                  {history[o.id] && (
                    <ul className="history small">
                      {history[o.id].loading ? <li className="muted">Cargando…</li> : history[o.id].events.map((e) => (
                        <li key={e.id}><strong>{eventLabel[e.status] || e.status}</strong> · {new Date(e.createdAt).toLocaleString('es-AR')}{e.detail && e.detail !== eventLabel[e.status] && <div className="muted">{e.detail}</div>}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="nowrap">
                  {['approved', 'manual'].includes(o.status) ? (
                    <>
                      <span className={`status e-${o.emailStatus}`} title={o.emailLastError || ''}>{emailLabel[o.emailStatus] || '-'}</span>
                      <div><button type="button" className="linklike small" onClick={() => resendEmail(o)}>{o.emailStatus === 'none' ? 'Enviar' : 'Reenviar'}</button></div>
                    </>
                  ) : <span className="muted">-</span>}
                </td>
                <td className="small">{o.mpPaymentId || '-'}</td>
              </tr>
            ))}
            {orders && orders.length === 0 && <tr><td colSpan="8" className="muted">Sin compras.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 className="mt-lg">Participaciones gratuitas</h3>
      <p className="small muted">Sin obligación de compra: 1 número por DNI, asignado al confirmar el email. Si un DNI parece falso, podés anular la participación.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Participante</th><th>Número</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {(freeList || []).map((f) => (
              <tr key={f.id}>
                <td className="nowrap">{new Date(f.createdAt).toLocaleString('es-AR')}</td>
                <td>{f.name}<div className="small muted">{f.email}</div><div className="small muted">DNI {f.dni}</div></td>
                <td>{f.number || '-'}</td>
                <td><span className={`status free-${f.status}`}>{freeLabel[f.status]}</span></td>
                <td>{f.status !== 'void' && <button type="button" className="linklike small" onClick={() => voidFree(f)}>Anular</button>}</td>
              </tr>
            ))}
            {freeList && freeList.length === 0 && <tr><td colSpan="5" className="muted">Todavía no hay participaciones gratuitas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
