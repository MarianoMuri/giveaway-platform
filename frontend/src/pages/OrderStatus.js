import { useParams, Link } from 'react-router-dom';
import brand from '../brand';
import { useApi } from '../hooks';
import { money, dateTime } from '../api';

const states = {
  pending: { icon: '⏳', title: 'Estamos esperando la confirmación del pago', text: 'Puede tardar unos segundos (o más si pagaste en efectivo). Esta página se actualiza sola.' },
  approved: { icon: '🎉', title: '¡Listo! Ya estás participando', text: 'Guardá esta página o sacale captura: es tu comprobante. El curso te llega por email.' },
  manual: { icon: '🎉', title: '¡Listo! Ya estás participando', text: 'Tu compra fue registrada.' },
  rejected: { icon: '❌', title: 'No se pudo iniciar el pago', text: 'Podés intentar de nuevo.' },
  needs_review: { icon: '⚠️', title: 'Estamos revisando tu pago', text: 'Hubo un problema con el monto de tu compra. Te vamos a contactar a la brevedad.' },
};

export default function OrderStatus() {
  const { id } = useParams();
  const { data: order, error } = useApi(`/orders/${id}`, { interval: 5000 });

  if (error) return <div className="container"><p className="alert">No encontramos esa compra.</p></div>;
  if (!order) return <div className="container"><p className="muted">Cargando…</p></div>;
  const s = states[order.status] || states.pending;
  const done = Boolean(order.firstNumber);
  const raffle = order.Raffle || {};

  return (
    <div className="container narrow">
      <div className="card center">
        <div className="big-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <p className="muted">{s.text}</p>

        {done && (
          <div className="numbers-box">
            <div className="small muted">Tus números para el sorteo</div>
            {order.firstNumber === order.lastNumber ? (
              <div className="numbers-range"><strong>{order.firstNumber}</strong></div>
            ) : (
              <div className="numbers-range">
                <strong>{order.firstNumber}</strong>
                <span className="muted">al</span>
                <strong>{order.lastNumber}</strong>
              </div>
            )}
            <div className="small">{order.chances} chances{order.double ? ' (con "Duplicá")' : ''}</div>
          </div>
        )}

        <div className="ticket">
          <div className="small muted">Sorteo</div>
          <div>{raffle.title} · {raffle.prize}</div>
          <div className="small muted mt-sm">Fecha del sorteo</div>
          <div>{dateTime(raffle.drawDate)}</div>
          <div className="small muted mt-sm">Curso</div>
          <div>{order.courseTitle}</div>
          <div className="small muted mt-sm">Comprador</div>
          <div>{order.buyerName}</div>
          <div className="small muted mt-sm">Total</div>
          <div>{money(order.amount)}</div>
          <div className="small muted mt-sm">Código de compra</div>
          <code className="small">{order.id}</code>
        </div>

        {order.status === 'rejected' && <Link to={`/sorteo/${order.RaffleId}`} className="btn mt">Volver a intentar</Link>}
        {done && raffle.youtubeUrl && <a href={raffle.youtubeUrl} className="btn mt" target="_blank" rel="noreferrer">Ver el sorteo en vivo ▶</a>}
        {done && brand.social.whatsappChannel && (
          <a href={brand.social.whatsappChannel} className="btn btn-ghost mt" target="_blank" rel="noreferrer">Unite al canal de WhatsApp</a>
        )}
        {order.status === 'needs_review' && brand.social.whatsappContact && (
          <a href={brand.social.whatsappContact} className="btn mt" target="_blank" rel="noreferrer">Escribinos por WhatsApp</a>
        )}
      </div>
    </div>
  );
}
