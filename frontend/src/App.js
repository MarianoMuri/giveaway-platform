import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import brand from './brand';
import { getToken, DEMO } from './api';
import DemoPayment from './demo/DemoPayment';
import Social from './components/Social';
import Home from './pages/Home';
import RafflePage from './pages/RafflePage';
import OrderStatus from './pages/OrderStatus';
import Terms from './pages/Terms';
import Links from './pages/Links';
import Login from './pages/admin/Login';
import Dashboard from './pages/admin/Dashboard';
import RaffleAdmin from './pages/admin/RaffleAdmin';

function RequireAdmin({ children }) {
  return getToken() ? children : <Navigate to="/admin/login" replace />;
}

function Header() {
  const { pathname } = useLocation();
  if (pathname === '/links') return null;
  const isAdmin = pathname.startsWith('/admin');
  return (
    <header className="header">
      <Link to={isAdmin ? '/admin' : '/'} className="logo">
        <img src={brand.logoUrl} alt="" className="logo-img" />
        <span>{brand.name}</span>
        {isAdmin && <span className="badge">Admin</span>}
      </Link>
    </header>
  );
}

function Footer() {
  const { pathname } = useLocation();
  if (pathname === '/links' || pathname.startsWith('/admin')) return null;
  return (
    <footer className="footer">
      <Social />
      <div className="mt-sm"><strong>{brand.name}</strong>{brand.location && <> · {brand.location}</>}</div>
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
          {DEMO && <Route path="/demo-pago/:id" element={<DemoPayment />} />}
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
          <Route path="/admin/sorteo/:id" element={<RequireAdmin><RaffleAdmin /></RequireAdmin>} />
          <Route path="*" element={<div className="container"><h2>Página no encontrada</h2><Link to="/">Volver al inicio</Link></div>} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
