// Medición opcional: Meta Pixel (publicidad en Facebook / Instagram) y Google Analytics 4.
// - Solo se activa si están definidas REACT_APP_META_PIXEL_ID y/o REACT_APP_GA_ID (sin variables no hace nada).
// - Solo se carga después de que la persona acepta el aviso de cookies.
// - Nunca se envían datos personales (nombre, DNI, email, teléfono): solo qué sorteo, el monto y la cantidad de chances.
const PIXEL_ID = (process.env.REACT_APP_META_PIXEL_ID || '').trim();
const GA_ID = (process.env.REACT_APP_GA_ID || '').trim();
const KEY = 'analyticsConsent';

export const analyticsConfigured = Boolean(PIXEL_ID || GA_ID);

let loaded = false;

export const getConsent = () => {
  try { return localStorage.getItem(KEY); } catch { return null; } // 'yes' | 'no' | null (sin decidir)
};

export function setConsent(value) {
  try { localStorage.setItem(KEY, value); } catch { /* sin storage: vale solo para esta visita */ }
  if (value === 'yes') load();
}

function load() {
  if (loaded || !analyticsConfigured) return;
  loaded = true;
  if (PIXEL_ID) {
    // Código estándar de Meta Pixel
    /* eslint-disable */
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', PIXEL_ID);
  }
  if (GA_ID) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { send_page_view: false, anonymize_ip: true }); // las vistas las mandamos nosotros (es una SPA)
  }
}

// Si ya había aceptado en una visita anterior, se carga al arrancar
if (analyticsConfigured && getConsent() === 'yes') load();

export function pageView(path) {
  if (!loaded) return;
  if (window.fbq) window.fbq('track', 'PageView');
  if (window.gtag) window.gtag('event', 'page_view', { page_path: path });
}

// Eventos de compra. "value" en pesos argentinos.
export function track(event, { id, name, value, chances } = {}) {
  if (!loaded) return;
  const base = { currency: 'ARS', ...(value != null && { value: Number(value) }) };
  const fb = { ...base, ...(name && { content_name: name }), ...(id != null && { content_ids: [String(id)] }), content_type: 'product', ...(chances != null && { num_items: chances }) };
  if (window.fbq) window.fbq('track', event, fb);
  const ga = { ViewContent: 'view_item', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' }[event];
  if (window.gtag && ga) window.gtag('event', ga, { ...base, items: [{ item_id: String(id ?? ''), item_name: name || '', quantity: chances ?? 1 }] });
}

// Una compra se informa una sola vez por navegador (al recargar el comprobante no se duplica)
export function trackPurchaseOnce(order) {
  const key = `tracked:${order.id}`;
  try { if (localStorage.getItem(key)) return; } catch { /* sin storage: puede repetirse */ }
  if (!loaded) return;
  track('Purchase', { id: order.RaffleId, name: order.Raffle?.title, value: order.amount, chances: order.chances });
  if (window.gtag) window.gtag('event', 'purchase', { transaction_id: String(order.id), currency: 'ARS', value: Number(order.amount) });
  try { localStorage.setItem(key, '1'); } catch { /* idem */ }
}
