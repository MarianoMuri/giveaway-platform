import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks';
import { api, money } from '../api';

// Pantalla que reemplaza al checkout de Mercado Pago SOLO en la demo.
export default function DemoPayment() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: order } = useApi(`/orders/${id}`);
  const [busy, setBusy] = useState(false);

  async function pay(result) {
    setBusy(true);
    await api(`/demo/pay/${id}`, { method: 'POST', body: { result } });
    nav(`/compra/${id}`);
  }

  if (!order) return <div className="container"><p className="muted">Cargando…</p></div>;
  return (
    <div className="container narrow">
      <div className="card center">
        <span className="pill demo-pill">Simulación de pago</span>
        <h2>Acá iría el checkout de Mercado Pago</h2>
        <p className="muted small">
          En la versión real, el comprador paga en Mercado Pago y vuelve solo a la página de su compra.
          En esta demo elegís el resultado.
        </p>
        <div className="ticket">
          <div className="small muted">Compra</div>
          <div>Curso "{order.courseTitle}" + {order.chances} chances</div>
          <div className="small muted mt-sm">Total a pagar</div>
          <div className="total-big">{money(order.amount)}</div>
        </div>
        <div className="row mt" style={{ justifyContent: 'center' }}>
          <button className="btn" disabled={busy} onClick={() => pay('approved')}>✅ Simular pago aprobado</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => pay('rejected')}>❌ Simular rechazo</button>
        </div>
      </div>
    </div>
  );
}
