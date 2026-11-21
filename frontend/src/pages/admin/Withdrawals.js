import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, money, dateTime } from '../../api';

const LABEL = { pending: 'Pendiente', approved: 'Devuelto', rejected: 'Rechazado' };

// Solicitudes de arrepentimiento: el administrador decide cada una. Aprobar devuelve el dinero por
// Mercado Pago y anula los números; rechazar pide un motivo y se lo avisa al comprador.
export default function Withdrawals() {
  const { data: rows, reload } = useApi('/admin/withdrawals', { auth: true });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  async function approve(w) {
    const o = w.order;
    const aviso = o?.raffle?.status === 'drawn' ? ' El sorteo ya se hizo.' : '';
    if (!window.confirm(`Vas a devolver ${money(o.amount)} a ${o.buyerName} y anular sus ${o.chances} chances.${aviso} ¿Confirmás?`)) return;
    setBusy(w.id);
    setMsg(null);
    try {
      const r = await api(`/admin/withdrawals/${w.id}/approve`, { method: 'POST', auth: true });
      setMsg(r.manualRefund ? 'Chances anuladas. Esta compra no se pagó por Mercado Pago: la plata hay que devolverla a mano.' : 'Devolución pedida a Mercado Pago y chances anuladas.');
      reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject(w) {
    const note = window.prompt('Motivo del rechazo (se lo mostramos al comprador):');
    if (!note) return;
    setBusy(w.id);
    setMsg(null);
    try {
      await api(`/admin/withdrawals/${w.id}/reject`, { method: 'POST', auth: true, body: { note } });
      reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container">
      <Link to="/admin" className="small">← Volver</Link>
      <h1 className="mt-sm">Arrepentimientos</h1>
      {msg && <p className="alert" role="status">{msg}</p>}
      {!rows ? <p className="muted">Cargando…</p> : rows.length === 0 ? <p className="muted">No hay solicitudes.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Solicitud</th><th>Comprador</th><th>Compra</th><th>Sorteo</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>{w.code}<div className="small muted">{dateTime(w.createdAt)}</div></td>
                  <td>{w.order ? w.order.buyerName : <em>Sin compra</em>}<div className="small muted">DNI {w.dni} · {w.email}</div></td>
                  <td>{w.order ? <>{w.order.courseTitle}<div className="small muted">{w.order.chances} chances · {money(w.order.amount)} · {w.order.paidWithMp ? 'Mercado Pago' : 'carga manual'}</div></> : <span className="small muted">No coincide ninguna compra: escribile al comprador.</span>}</td>
                  <td>{w.order?.raffle ? <>{w.order.raffle.title}<div className="small muted">{w.order.raffle.status === 'drawn' ? 'Ya sorteado' : 'Sin sortear'}</div></> : '-'}</td>
                  <td>{LABEL[w.status]}{w.note && <div className="small muted">{w.note}</div>}</td>
                  <td>
                    {w.status === 'pending' && (
                      <div className="row">
                        {w.order && <button className="btn btn-sm" disabled={busy === w.id} onClick={() => approve(w)}>Aprobar y devolver</button>}
                        <button className="btn btn-ghost btn-sm" disabled={busy === w.id} onClick={() => reject(w)}>Rechazar</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
