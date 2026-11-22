import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks';
import { money, dateTime } from '../api';
import brand from '../brand';

export default function Terms() {
  const { id } = useParams();
  const { data: r } = useApi(`/raffles/${id}`);
  const { data: offer } = useApi(`/raffles/${id}/packs`);
  const { data: provinces } = useApi('/provinces');
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
        {r.freeEntryEnabled && (
          <li>
            <strong>Sin obligación de compra:</strong> también se puede participar gratis, con 1 número por DNI y por sorteo,
            desde <Link to={`/sorteo/${id}/participar-gratis`}>la página de participación gratuita</Link>. El número se asigna al confirmar el email
            y tiene las mismas posibilidades que los demás.
          </li>
        )}
        <li>Los números se asignan de forma automática y consecutiva al acreditarse el pago, empezando por el 100000.</li>
        {(r.excludedProvinces || []).length > 0 && provinces && (
          <li>
            Por el momento el sorteo no está disponible para residentes de: {provinces.filter((p) => r.excludedProvinces.includes(p.code)).map((p) => p.name).join(', ')}.
          </li>
        )}
        {brand.location && <li>Las compras se realizan en {brand.location}, lugar habilitado para este sorteo.</li>}
        <li>Fecha del sorteo: {dateTime(r.drawDate)}</li>
      </ul>
      <div className="terms">{r.terms || 'Las bases y condiciones completas se publicarán antes del inicio de la venta.'}</div>
    </div>
  );
}
