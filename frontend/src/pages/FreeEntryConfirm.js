import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dateTime } from '../api';

// Página a la que lleva el link del email: confirma y muestra el número asignado
export default function FreeEntryConfirm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(params.get('token'));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    navigate('/participar-gratis/confirmar', { replace: true }); // el token sale de la barra de direcciones
    if (!token) return setError('El link no es válido.');
    api('/free-entries/confirm', { method: 'POST', body: { token } }).then(setResult).catch((e) => setError(e.message));
  }, [token, navigate]);

  if (error) return <div className="container narrow"><p className="alert">{error}</p><Link to="/" className="btn mt">Volver al inicio</Link></div>;
  if (!result) return <div className="container narrow"><p className="muted">Confirmando tu participación…</p></div>;

  return (
    <div className="container narrow">
      <div className="card center">
        <div className="big-icon">🎉</div>
        <h2>¡Ya estás participando, {result.name.split(' ')[0]}!</h2>
        <div className="numbers-box">
          <div className="small muted">Tu número gratuito</div>
          <div className="numbers-range"><strong>{result.number}</strong></div>
        </div>
        <div className="ticket">
          <div className="small muted">Sorteo</div>
          <div>{result.raffle.title} · {result.raffle.prize}</div>
          <div className="small muted mt-sm">Fecha del sorteo</div>
          <div>{dateTime(result.raffle.drawDate)}</div>
        </div>
        <p className="small muted mt">Guardá este número (también te lo mandamos por email). Si ganás, vas a tener que acreditar tu identidad con el DNI.</p>
        {result.raffle.youtubeUrl && <a href={result.raffle.youtubeUrl} className="btn mt" target="_blank" rel="noreferrer">Ver el sorteo en vivo ▶</a>}
        <Link to="/" className="btn btn-ghost mt">Volver al inicio</Link>
      </div>
    </div>
  );
}
