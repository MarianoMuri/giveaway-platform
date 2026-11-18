import brand from '../brand';

const icons = {
  instagram: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" /></svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" /><path d="M10 9l5 3-5 3z" fill="var(--bg)" /></svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3c-2.8 0-4 1.8-4 4.3V10H7v4h3v8h4v-8h3l.5-4H14V8.6c0-.4.3-.6.6-.6z" fill="currentColor" /></svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h3c.3 2.2 1.7 3.6 4 3.9V10c-1.5 0-2.9-.5-4-1.3V15a6 6 0 11-6-6v3.2A2.8 2.8 0 1014 15z" fill="currentColor" /></svg>
  ),
  whatsappChannel: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 01-2.3-2.3l.8-1-1-2z" fill="currentColor" /></svg>
  ),
};

export const socialNames = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  whatsappChannel: 'Canal de WhatsApp',
};

export const activeSocials = () =>
  Object.keys(socialNames).filter((k) => brand.social[k]).map((k) => ({ key: k, name: socialNames[k], url: brand.social[k], icon: icons[k] }));

// Fila de íconos redondos
export default function Social({ size = 'md' }) {
  const list = activeSocials();
  if (!list.length) return null;
  return (
    <div className={`social social-${size}`}>
      {list.map((s) => (
        <a key={s.key} href={s.url} target="_blank" rel="noreferrer" aria-label={s.name} title={s.name} className={`social-btn sb-${s.key}`}>
          {s.icon}
        </a>
      ))}
    </div>
  );
}

export function SocialIcon({ name }) {
  return <span className="inline-icon">{icons[name]}</span>;
}
