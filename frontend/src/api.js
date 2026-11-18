// En desarrollo usa el proxy de package.json; en producción, REACT_APP_API_URL.
const BASE = process.env.REACT_APP_API_URL || '';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export const DEMO = process.env.REACT_APP_DEMO === 'true';

// Navega a una ruta interna o externa. En la demo (sin URL real) usa el router.
export function goTo(url) {
  if (url.startsWith('/') && window.__nav) window.__nav(url);
  else window.location.href = url;
}

export function getToken() {
  try {
    return localStorage.getItem('adminToken');
  } catch {
    return null;
  }
}
export function setToken(t) {
  try {
    if (t) localStorage.setItem('adminToken', t);
    else localStorage.removeItem('adminToken');
  } catch {
    /* sin storage */
  }
}

export async function api(path, { method = 'GET', body, auth = false, raw = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, {});
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    setToken(null);
    goTo('/admin/login');
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const money = (n) =>
  Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export const dateTime = (d) =>
  d
    ? new Date(d).toLocaleString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      })
    : 'A confirmar';

export const dateShort = (d) =>
  d
    ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·') + ' h'
    : 'A confirmar';
