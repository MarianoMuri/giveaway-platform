import { useParams, Link } from 'react-router-dom';
import brand from '../brand';
import { useApi } from '../hooks';
import { money } from '../api';

const states = {
  pending: { icon: '⏳', title: 'Estamos esperando la confirmación del pago', text: 'Puede tardar unos segundos. Esta página se actualiza sola.' },
  approved: { icon: '✅', title: '¡Listo! Ya estás participando', text: 'Guardá esta página o sacale captura: es tu comprobante.' },
  manual: { icon: '✅', title: '¡Listo! Ya estás participando', text: 'Tu compra fue registrada.' },
  expired: { icon: '⌛', title: 'La reserva venció', text: 'No recibimos el pago a tiempo y los números se liberaron. Si te cobraron, escribinos.' },
  rejected: { icon: '❌', title: 'El pago fue rechazado', text: 'Podés intentar de nuevo con otro medio de pago.' },
  needs_review: { icon: '⚠️', title: 'Estamos revisando tu pago', text: 'Hubo un problema con tu compra. Te vamos a contactar a la brevedad.' },
};

export default function OrderStatus() {
  const { id } = useParams();
  const { data: order, error } = useApi(`/orders/${id}`, { interval: 5000 });

  if (error) return <div className="container"><p className="alert">No encontramos esa compra.</p></div>;
  if (!order) return <div className="container"><p className="muted">Cargando…</p></div>;
  const s = states[order.status] || states.pending;

  return (
    <div className="container narrow">
      <div className="card center">
        <div className="big-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <p className="muted">{s.text}</p>
        <div className="ticket">
          <div className="small muted">Comprador</div>
          <div>{order.buyerName}</div>
          <div className="small muted mt-sm">Tus números</div>
          <div className="chips center-chips">
            {order.numbers.map((n) => <span key={n} className="chip">{n}</span>)}
          </div>
          <div className="small muted mt-sm">Total</div>
          <div>{money(order.amount)}</div>
          <div className="small muted mt-sm">Código de compra</div>
          <code className="small">{order.id}</code>
        </div>
        {(order.status === 'expired' || order.status === 'rejected') && (
          <Link to={`/sorteo/${order.RaffleId}`} className="btn mt">Volver a elegir números</Link>
        )}
        {(order.status === 'approved' || order.status === 'manual') && brand.social.whatsappChannel && (
          <a href={brand.social.whatsappChannel} className="btn mt" target="_blank" rel="noreferrer">Unite al canal de WhatsApp</a>
        )}
        {order.status === 'needs_review' && brand.social.whatsappContact && (
          <a href={brand.social.whatsappContact} className="btn mt" target="_blank" rel="noreferrer">Escribinos por WhatsApp</a>
        )}
      </div>
    </div>
  );
}
