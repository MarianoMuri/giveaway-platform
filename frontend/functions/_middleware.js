// Cloudflare Pages Function: personaliza las etiquetas de vista previa (Open Graph) al compartir un link.
// Los robots de WhatsApp/Instagram/Facebook no ejecutan JavaScript, por eso se completan acá, en el servidor.
// Si algo falla, devuelve la página tal cual (nunca rompe el sitio).
import { shareMeta, raffleIdFromPath } from '../share/og.mjs';

async function loadRaffle(env, id) {
  const api = (env.REACT_APP_API_URL || '').replace(/\/$/, '');
  if (!api || !id) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`${api}/api/raffles/${id}`, { signal: ctrl.signal, cf: { cacheTtl: 60, cacheEverything: true } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request, next, env }) {
  const response = await next();
  try {
    const url = new URL(request.url);
    const type = response.headers.get('content-type') || '';
    if (request.method !== 'GET' || !type.includes('text/html') || url.pathname.startsWith('/admin')) return response;

    const raffle = await loadRaffle(env, raffleIdFromPath(url.pathname));
    const m = shareMeta({
      origin: url.origin,
      pathname: url.pathname,
      brand: { name: env.REACT_APP_BRAND_NAME, description: env.REACT_APP_BRAND_DESCRIPTION, image: env.REACT_APP_BRAND_SHARE_IMAGE },
      raffle,
    });
    const setContent = (value) => ({ element: (el) => el.setAttribute('content', value) });
    return new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(m.title) })
      .on('meta[name="description"]', setContent(m.description))
      .on('meta[property="og:title"]', setContent(m.title))
      .on('meta[property="og:description"]', setContent(m.description))
      .on('meta[property="og:image"]', setContent(m.image))
      .on('meta[property="og:url"]', setContent(m.url))
      .on('meta[property="og:site_name"]', setContent(m.siteName))
      .on('meta[name="twitter:title"]', setContent(m.title))
      .on('meta[name="twitter:description"]', setContent(m.description))
      .on('meta[name="twitter:image"]', setContent(m.image))
      .transform(response);
  } catch {
    return response;
  }
}
