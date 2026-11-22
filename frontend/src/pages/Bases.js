import { Link } from 'react-router-dom';
import BASES from '../basesText';

export default function Bases() {
  return (
    <div className="container narrow">
      <Link to="/" className="small">← Volver al inicio</Link>
      <h1 className="mt-sm">Bases y condiciones</h1>
      <div className="terms">{BASES}</div>
    </div>
  );
}
