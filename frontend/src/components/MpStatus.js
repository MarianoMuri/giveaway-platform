import { useState } from 'react';
import { useApi } from '../hooks';
import { api } from '../api';

const ago = (iso) => {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
};

// Indicador de la conexión con Mercado Pago. El servidor la chequea solo cada pocos minutos y avisa
// por email si se cae; acá se ve el último resultado y se puede forzar un chequeo.
export default function MpStatus() {
  const { data, setData, error } = useApi('/admin/mp-status', { auth: true, interval: 60000 });
  const [busy, setBusy] = useState(false);

  async function recheck() {
    setBusy(true);
    try {
      setData(await api('/admin/mp-status/check', { method: 'POST', auth: true }));
    } finally {
      setBusy(false);
    }
  }

  if (error || !data) return null;
  const { status, reason, checkedAt, since } = data;
  const label = { ok: 'OK', down: 'CAÍDA', unknown: 'verificando…', not_configured: 'sin configurar' }[status];
  const cls = status === 'ok' ? 'ok' : status === 'down' ? 'alert' : 'neutral';

  return (
    <div className={`mp-status ${cls}`} role="status">
      <div>
        <strong>Conexión con Mercado Pago: {label}</strong>
        {status === 'ok' && checkedAt && <span className="muted"> · verificada {ago(checkedAt)}</span>}
        {status === 'down' && (
          <>
            <br />
            {reason} Mientras siga caída no se pueden cobrar compras nuevas. Te avisamos por email.
            {since && <span className="muted"> Desde {ago(since)}.</span>}
          </>
        )}
        {status === 'not_configured' && <span className="muted"> · falta cargar las credenciales en el servidor</span>}
      </div>
      {status !== 'not_configured' && (
        <button className="btn btn-ghost" onClick={recheck} disabled={busy}>{busy ? 'Verificando…' : 'Verificar ahora'}</button>
      )}
    </div>
  );
}
