import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import brand from './brand';
import { getToken, getRole, DEMO } from './api';
import DemoPayment from './demo/DemoPayment';
import Social from './components/Social';
import Home from './pages/Home';
import RafflePage from './pages/RafflePage';
import OrderStatus from './pages/OrderStatus';
import Terms from './pages/Terms';
import Links from './pages/Links';
import MisNumeros from './pages/MisNumeros';
import FreeEntry from './pages/FreeEntry';
import FreeEntryConfirm from './pages/FreeEntryConfirm';
import Login from './pages/admin/Login';
import Dashboard from './pages/admin/Dashboard';
import RaffleAdmin from './pages/admin/RaffleAdmin';
import Courses from './pages/admin/Courses';
import LiveDraw from './pages/admin/LiveDraw';
import LiveHub from './pages/admin/LiveHub';
import Analytics from './components/Analytics';

function RequireAdmin({ children }) {
  return getToken() ? children : <Navigate to="/admin/login" replace />;
}
// Pantallas del panel completo: el operador del sorteo en vivo vuelve a su entrada
function RequireFullAdmin({ children }) {
  if (!getToken()) return <Navigate to="/admin/login" replace />;
  return getRole() === 'live' ? <Navigate to="/admin/en-vivo" replace /> : children;
}

function Header() {
  const { pathname } = useLocation();
  if (pathname === '/links') return null;
  const isAdmin = pathname.startsWith('/admin');
  return (
    <header className="header">
      <Link to={isAdmin ? (getRole() === 'live' ? '/admin/en-vivo' : '/admin') : '/'} className="logo">
        <img src={brand.logoUrl} alt="" className="logo-img" />
        <span>{brand.name}</span>
        {isAdmin && <span className="badge">Admin</span>}
      </Link>
      {!isAdmin && <Link to="/mis-numeros" className="header-link">Mis números</Link>}
      {!isAdmin && <div className="header-social"><Social size="sm" /></div>}
    </header>
  );
}

function Footer() {
  const { pathname } = useLocation();
  if (pathname === '/links' || pathname.startsWith('/admin')) return null;
  return (
    <footer className="footer">
      <div><strong>{brand.name}</strong>{brand.location && <> · {brand.location}</>}</div>
      <Social size="sm" />
      <div className="muted small">Pagos procesados por Mercado Pago</div>
    </footer>
  );
}

function DemoBar() {
  window.__nav = useNavigate();
  const { pathname } = useLocation();
  if (!DEMO) return null;
  return (
    <div className="demo-bar">
      <span><strong>DEMO</strong> · datos ficticios, sin cobros reales</span>
      <span className="demo-links">
        <Link to="/">Sitio</Link>
        <Link to="/links">Links</Link>
        <Link to="/admin">Panel admin</Link>
      </span>
      {pathname.startsWith('/admin') && <span className="small">Usuario: demo@demo.com · Clave: demo</span>}
    </div>
  );
}

export default function App() {
  return (
    <>
      <DemoBar />
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/links" element={<Links />} />
          <Route path="/sorteo/:id" element={<RafflePage />} />
          <Route path="/sorteo/:id/bases" element={<Terms />} />
          <Route path="/compra/:id" element={<OrderStatus />} />
          <Route path="/mis-numeros" element={<MisNumeros />} />
          <Route path="/mis-compras" element={<Navigate to={`/mis-numeros${window.location.search}`} replace />} />
          <Route path="/sorteo/:id/participar-gratis" element={<FreeEntry />} />
          <Route path="/participar-gratis/confirmar" element={<FreeEntryConfirm />} />
          {DEMO && <Route path="/demo-pago/:id" element={<DemoPayment />} />}
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<RequireFullAdmin><Dashboard /></RequireFullAdmin>} />
          <Route path="/admin/cursos" element={<RequireFullAdmin><Courses /></RequireFullAdmin>} />
          <Route path="/admin/en-vivo" element={<RequireAdmin><LiveHub /></RequireAdmin>} />
          <Route path="/admin/sorteo/:id/en-vivo" element={<RequireAdmin><LiveDraw /></RequireAdmin>} />
          <Route path="/admin/sorteo/:id" element={<RequireFullAdmin><RaffleAdmin /></RequireFullAdmin>} />
          <Route path="*" element={<div className="container"><h2>Página no encontrada</h2><Link to="/">Volver al inicio</Link></div>} />
        </Routes>
      </main>
      <Footer />
      <Analytics />
    </>
  );
}
