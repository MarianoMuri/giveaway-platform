import { Link } from 'react-router-dom';
import brand from '../brand';
import { useApi } from '../hooks';
import { money, dateShort } from '../api';
import Social from '../components/Social';
import Faq from '../components/Faq';
import HowItWorks from '../components/HowItWorks';

export default function Home() {
  const { data: raffles, loading, error } = useApi('/raffles');
  const { data: courses } = useApi('/courses');
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
          {!brand.heroUrl && <p className="lead">{brand.description}</p>}
          {/* En el celular el encabezado no tiene redes: se muestran acá */}
          <ul className="perks">
            <li>⚡ Números al instante</li>
            <li>📺 Sorteo en vivo</li>
            <li>📘 Curso en tu email</li>
          </ul>
          <div className="hero-social"><Social size="md" /></div>
        </div>
      </section>

      <div className="container">
        {/* Con imagen destacada: logo a la izquierda y sorteo a la derecha (en el celular, una columna) */}
        <div className={brand.heroUrl ? 'split' : undefined}>
        {brand.heroUrl && (
          <div className="split-side">
            <img src={brand.heroUrl} alt={brand.name} className="hero-img" />
            <p className="lead">{brand.description}</p>
          </div>
        )}
        <div className="split-main">
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
              </dl>
              <p className="small muted">Comprás un curso digital y te regalamos chances para el sorteo.</p>
              {r.salesOpen === false ? (
                <p className="alert" role="status">La venta de este sorteo ya cerró. ¡Mucha suerte a todos los participantes!</p>
              ) : (
                <>
                  {r.salesCloseAt && <p className="small muted">La venta cierra el {dateShort(r.salesCloseAt)} h</p>}
                  <Link to={`/sorteo/${r.id}`} className="btn btn-lg">Quiero participar</Link>
                  {r.freeEntryEnabled && (
                    <p className="small muted mt-sm">Sin obligación de compra: también podés <Link to={`/sorteo/${r.id}/participar-gratis`}>participar gratis</Link>.</p>
                  )}
                </>
              )}
              <div className="small muted mt">
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

        {active.length > 0 && (
          <p className="center"><Link to="/links" className="btn btn-ghost">Ver nuestras redes</Link></p>
        )}
        </div>
        </div>

        <HowItWorks />

        {courses && courses.length > 0 && (
          <section className="mt-lg home-courses">
            <h3>Cursos disponibles ({courses.length})</h3>
            <p className="muted small">Con cada compra elegís uno y te llevás chances para el sorteo.</p>
            <ul className="course-chips">
              {courses.map((c) => <li key={c.id}>{c.title}</li>)}
            </ul>
          </section>
        )}

        {past.length > 0 && (
          <section className="mt-lg">
            <h3>Ganadores anteriores</h3>
            <div className="winners">
              {past.map((r) => (
                <div key={r.id} className="card winner">
                  <div className="muted small">{r.title}</div>
                  <div className="prize">{r.prize}</div>
                  <div>Número ganador: <strong className="gold">{r.winnerNumber}</strong></div>
                  {r.winnerName && <div>Ganó: <strong>{r.winnerName}</strong></div>}
                  {r.youtubeUrl && <a href={r.youtubeUrl} target="_blank" rel="noreferrer" className="small">Ver el sorteo ▶</a>}
                </div>
              ))}
            </div>
          </section>
        )}

        <Faq raffle={active[0]} />
      </div>
    </>
  );
}
