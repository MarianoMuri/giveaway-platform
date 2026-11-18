import { useApi } from '../hooks';
import { dateTime } from '../api';

const actionLabel = {
  'login.ok': 'Ingresó al panel', 'login.failed': 'Intento de ingreso fallido',
  'raffle.create': 'Creó el sorteo', 'raffle.update': 'Modificó el sorteo', 'packs.update': 'Modificó los packs',
  'readiness.check': 'Consultó si están todos los clientes cargados', 'order.manual': 'Cargó una venta manual',
  'order.resend_email': 'Reenvió un email de compra', 'free_entry.void': 'Anuló una participación gratuita',
  'course.create': 'Creó un curso', 'course.update': 'Modificó un curso', 'course.delete': 'Eliminó un curso',
  'draw.run': 'Realizó el sorteo', 'draw.redo': 'Repitió el sorteo', 'draw.discarded': 'Descartó un número anulado',
  'winner.manual': 'Cargó el ganador a mano', 'winner.manual_redo': 'Cambió el ganador (a mano)',
};

// Sorteos realizados y registro de actividad de los administradores (solo lectura)
export default function ActivityLog({ raffleId, refreshKey }) {
  const { data: draws } = useApi(`/admin/raffles/${raffleId}/draws?k=${refreshKey}`, { auth: true });
  const { data: logs } = useApi(`/admin/audit?raffleId=${raffleId}&limit=50&k=${refreshKey}`, { auth: true });
  return (
    <>
      {draws?.length > 0 && (
        <section className="card">
          <h3>Sorteos realizados</h3>
          <table className="table">
            <thead><tr><th>Fecha</th><th>Número</th><th>Cómo</th><th>Quién</th><th>Estado</th></tr></thead>
            <tbody>
              {draws.map((d) => (
                <tr key={d.id} className={d.supersededAt ? 'voided' : ''}>
                  <td className="nowrap">{dateTime(d.createdAt)}</td>
                  <td><strong>{d.number}</strong></td>
                  <td>{d.method === 'random' ? `Al azar entre ${d.validCount?.toLocaleString('es-AR')} (posición ${d.position})` : 'Cargado a mano'}{d.reason && <div className="small muted">Motivo: {d.reason}</div>}</td>
                  <td>{d.actor}</td>
                  <td>{d.supersededAt ? 'Reemplazado' : 'Vigente'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="card">
        <h3>Registro de actividad</h3>
        <p className="small muted">Todo lo que hacen los administradores en este sorteo. Solo se puede leer: no se edita ni se borra.</p>
        {!logs ? <p className="muted">Cargando…</p> : logs.length === 0 ? <p className="muted">Sin actividad registrada.</p> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{dateTime(l.createdAt)}</td>
                  <td>{l.actor}</td>
                  <td>{actionLabel[l.action] || l.action}</td>
                  <td className="small muted">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
