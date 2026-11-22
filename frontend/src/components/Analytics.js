import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DEMO } from '../api';
import { analyticsConfigured, getConsent, pageView, setConsent } from '../analytics';

// Aviso de cookies + vista de página en cada cambio de ruta. No aparece en el panel de administración
// ni si no hay Pixel / Analytics configurados.
export default function Analytics() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState(getConsent());
  const isAdmin = pathname.startsWith('/admin');
  const active = analyticsConfigured && !DEMO && !isAdmin;

  useEffect(() => {
    if (active && choice === 'yes') pageView(pathname);
  }, [pathname, choice, active]);

  if (!active || choice) return null;
  const decide = (value) => { setConsent(value); setChoice(value); };

  return (
    <div className="consent" role="dialog" aria-label="Aviso de cookies">
      <p>Usamos cookies para medir las visitas y mejorar nuestra publicidad. No guardamos tus datos personales en ellas.</p>
      <div className="consent-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => decide('no')}>Rechazar</button>
        <button className="btn btn-sm" onClick={() => decide('yes')}>Aceptar</button>
      </div>
    </div>
  );
}
