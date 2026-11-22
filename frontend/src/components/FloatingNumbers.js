import { Link, useLocation } from 'react-router-dom';

// Botón flotante "Ver mis números": acompaña al bajar la página y lleva a la consulta con DNI
export default function FloatingNumbers() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin') || pathname === '/links' || pathname.startsWith('/mis-numeros') || pathname.startsWith('/mis-compras')) return null;
  return (
    <Link to="/mis-numeros" className="float-numbers">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5v2M15 11v2M15 17v2" /><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" /></svg>
      Ver mis números
    </Link>
  );
}
