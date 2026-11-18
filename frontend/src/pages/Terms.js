import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks';
import { money, dateTime } from '../api';

export default function Terms() {
  const { id } = useParams();
  const { data: r } = useApi(`/raffles/${id}`);
  const { data: offer } = useApi(`/raffles/${id}/packs`);
  if (!r) return <div className="container"><p className="muted">Cargando…</p></div>;
  return (
    <div className="container narrow">
      <Link to={`/sorteo/${id}`} className="small">← Volver al sorteo</Link>
      <h1 className="mt-sm">Bases y condiciones</h1>
      <h3>{r.title}</h3>
      <ul className="muted">
        <li>Premio: {r.prize}</li>
        <li>Cada compra incluye un curso digital y chances de regalo para el sorteo.</li>
        {(offer?.packs || []).map((p) => (
          <li key={p.id}>
            Pack de {p.chances} chances: {money(p.price)}
            {p.double && <> (con "Duplicá": {p.double.chances} chances por {money(p.double.total)})</>}
          </li>
        ))}
        <li>Los números se asignan de forma automática y consecutiva al acreditarse el pago, empezando por el 100000.</li>
        <li>Fecha del sorteo: {dateTime(r.drawDate)}</li>
        {r.permitNumber && <li>Autorización N° {r.permitNumber}</li>}
      </ul>
      <div className="terms">{r.terms || 'Las bases y condiciones completas se publicarán antes del inicio de la venta.'}</div>
    </div>
  );
}
