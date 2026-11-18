import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks';
import { money, dateTime } from '../api';

export default function Terms() {
  const { id } = useParams();
  const { data: r } = useApi(`/raffles/${id}`);
  if (!r) return <div className="container"><p className="muted">Cargando…</p></div>;
  return (
    <div className="container narrow">
      <Link to={`/sorteo/${id}`} className="small">← Volver al sorteo</Link>
      <h1 className="mt-sm">Bases y condiciones</h1>
      <h3>{r.title}</h3>
      <ul className="muted">
        <li>Premio: {r.prize}</li>
        <li>Valor de cada número: {money(r.pricePerNumber)}</li>
        {(r.promos || []).map((p) => <li key={p.qty}>Promo: {p.qty} números por {money(p.price)}</li>)}
        <li>Cantidad de números: {r.totalNumbers.toLocaleString('es-AR')}</li>
        <li>Fecha del sorteo: {dateTime(r.drawDate)}</li>
        {r.permitNumber && <li>Autorización N° {r.permitNumber}</li>}
      </ul>
      <div className="terms">{r.terms || 'Las bases y condiciones completas se publicarán antes del inicio de la venta.'}</div>
    </div>
  );
}
