import { useState } from 'react';
import { Link } from 'react-router-dom';
import brand from '../brand';
import { useApi } from '../hooks';
import Social, { activeSocials, SocialIcon } from '../components/Social';

const linkLabels = {
  youtube: 'YouTube · Sorteos en vivo',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsappChannel: 'Canal de WhatsApp · Novedades',
  tiktok: 'TikTok',
};

export default function Links() {
  const { data: raffles } = useApi('/raffles');
  const active = (raffles || []).filter((r) => r.status === 'active');
  const [logoOk, setLogoOk] = useState(true);

  return (
    <div className="links-page">
      {logoOk ? (
        <img src={brand.logoUrl} alt={brand.name} className="avatar" onError={() => setLogoOk(false)} />
      ) : (
        <div className="avatar avatar-text">{brand.name[0]}</div>
      )}
      <h1>{brand.name}</h1>
      <p className="muted">{brand.tagline}</p>
      <Social size="lg" />

      <div className="link-list">
        {active.map((r) => (
          <Link key={r.id} to={`/sorteo/${r.id}`} className="link-btn featured">
            🚗 {r.title} — ¡Comprá tus números!
          </Link>
        ))}
        {activeSocials().map((s) => (
          <a key={s.key} href={s.url} className={`link-btn link-${s.key}`} target="_blank" rel="noreferrer">
            <SocialIcon name={s.key} /> {linkLabels[s.key]}
          </a>
        ))}
        {brand.social.whatsappContact && (
          <a href={brand.social.whatsappContact} className="link-btn" target="_blank" rel="noreferrer">💬 Escribinos por WhatsApp</a>
        )}
        {brand.extraLinks.map((l) => (
          <a key={l.url} href={l.url} className="link-btn" target="_blank" rel="noreferrer">{l.label}</a>
        ))}
        <Link to="/" className="link-btn">🌐 Sitio web</Link>
      </div>
      {brand.location && <p className="small muted">{brand.location}</p>}
    </div>
  );
}
