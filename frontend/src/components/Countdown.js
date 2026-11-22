import { useEffect, useState } from 'react';

// Cuenta regresiva hasta el cierre de la venta. Se actualiza sola; al llegar a cero avisa que cerró.
function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export default function Countdown({ until }) {
  const end = Date.parse(until);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (Number.isNaN(end)) return null;
  const left = end - now;
  if (left <= 0) return <p className="countdown closed" role="status">La venta ya cerró.</p>;
  const { d, h, m, s } = parts(left);
  const cell = (n, label) => (<span className="cd-cell"><strong>{String(n).padStart(2, '0')}</strong><small>{label}</small></span>);
  return (
    <div className={`countdown ${left < 3600000 ? 'urgent' : ''}`} role="timer" aria-label="Tiempo que falta para el cierre de la venta">
      <span className="cd-title">⏳ La venta cierra en</span>
      <span className="cd-cells">
        {d > 0 && cell(d, d === 1 ? 'día' : 'días')}
        {cell(h, 'hs')}
        {cell(m, 'min')}
        {cell(s, 'seg')}
      </span>
    </div>
  );
}
