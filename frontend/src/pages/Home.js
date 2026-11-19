import { Link } from 'react-router-dom';
import Social from '../components/Social';
import brand from '../brand';
import { useApi } from '../hooks';
import { money, dateShort } from '../api';
import SalesProgress from '../components/SalesProgress';

export default function Home() {
  const { data: raffles, loading, error } = useApi('/raffles');
  const active = (raffles || []).filter((r) => r.status === 'active');
  const past = (raffles || []).filter((r) => r.status === 'drawn');

  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">{brand.tagline}</p>
          <h1>
            {brand.name.split(' ').slice(0, -1).join(' ')}{' '}
            <span className="accent">{brand.name.split(' ').slice(-1)}</span>
          </h1>
          {brand.heroUrl && <img src={brand.heroUrl} alt={brand.name} className="hero-img" />}
          <Social size="lg" />
          <p className="lead">{brand.description}</p>
        </div>
      </section>

      <div className="container">
        {loading && <p className="muted">Cargando sorteos…</p>}
        {error && <p className="alert">No pudimos cargar los sorteos. Probá de nuevo en un rato.</p>}

        {active.map((r) => (
          <article key={r.id} className="card raffle-card">
            {r.imageUrl && <img src={r.imageUrl} alt={r.prize} className={`raffle-img ${r.imageUrl === brand.logoUrl ? 'is-logo' : ''}`} />}
            <div className="raffle-body">
              <span className="pill">Sorteo activo</span>
              <h2>{r.title}</h2>
              <p className="prize">🚗 {r.prize}</p>
              {r.description && <p className="muted">{r.description}</p>}
              <dl className="facts">
                <div><dt>Desde</dt><dd>{r.fromPrice ? money(r.fromPrice) : '-'}</dd></div>
                <div><dt>Sorteo</dt><dd>{dateShort(r.drawDate)}</dd></div>
                <div><dt>Vendidas</dt><dd>{(r.chancesSold || 0).toLocaleString('es-AR')}</dd></div>
              </dl>
              <SalesProgress raffle={r} compact />
              <p className="small muted">Comprás un curso digital y te regalamos chances para el sorteo.</p>
              <Link to={`/sorteo/${r.id}`} className="btn btn-lg">Quiero participar</Link>
              {r.freeEntryEnabled && (
                <p className="small muted mt-sm">Sin obligación de compra: también podés <Link to={`/sorteo/${r.id}/participar-gratis`}>participar gratis</Link>.</p>
              )}
              <div className="small muted mt">
                {r.permitNumber && <>Autorización N° {r.permitNumber} · </>}
                <Link to={`/sorteo/${r.id}/bases`}>Bases y condiciones</Link>
              </div>
            </div>
          </article>
        ))}

        {!loading && !error && active.length === 0 && (
          <div className="card center">
            <h2>Se viene un nuevo sorteo</h2>
            <p className="muted">Seguinos en las redes para enterarte primero.</p>
            <Link to="/links" className="btn">Ver nuestras redes</Link>
          </div>
        )}

        <section className="card center follow">
          <h3>Seguí los sorteos en vivo</h3>
          <p className="muted small">Transmitimos cada sorteo en directo y publicamos los ganadores en nuestras redes.</p>
          <Social size="lg" />
        </section>

        {past.length > 0 && (
          <section className="mt-lg">
            <h3>Ganadores anteriores</h3>
            <div className="winners">
              {past.map((r) => (
                <div key={r.id} className="card winner">
                  <div className="muted small">{r.title}</div>
                  <div className="prize">{r.prize}</div>
                  <div>Número ganador: <strong className="gold">{r.winnerNumber}</strong></div>
                  {r.youtubeUrl && <a href={r.youtubeUrl} target="_blank" rel="noreferrer" className="small">Ver el sorteo ▶</a>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
