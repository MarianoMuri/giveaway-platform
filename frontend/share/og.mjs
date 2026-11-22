// Arma los datos de la vista previa (Open Graph) que se ve al compartir un link por WhatsApp, Instagram, etc.
// Es una función pura: la usa functions/_middleware.js (Cloudflare Pages) y se prueba con og.test.mjs.

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

const absolute = (url, origin) => {
  if (!url) return '';
  try {
    const u = new URL(url, origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
};

// brand: { name, description, image } (de las variables del proyecto); raffle: sorteo público o null
export function shareMeta({ origin, pathname, brand, raffle }) {
  const name = clean(brand.name, 80) || 'Auto Sorteos';
  const defaultImage = absolute(brand.image, origin) || `${origin}/share-default.jpg`;
  let title = name;
  let description = clean(brand.description, 200);
  let image = defaultImage;

  if (raffle && raffle.title) {
    title = `${clean(raffle.title, 90)} · ${name}`;
    const prize = clean(raffle.prize, 90);
    description = prize ? `Sorteamos ${prize}. ${description}` : description;
    image = absolute(raffle.imageUrl, origin) || defaultImage;
  }
  return { title, description: clean(description, 200), image, url: origin + pathname, siteName: name };
}

// Rutas donde conviene personalizar la vista previa: "/sorteo/<id>" (y solo esa)
export function raffleIdFromPath(pathname) {
  const m = /^\/sorteo\/([0-9]+)\/?$/.exec(pathname);
  return m ? m[1] : null;
}
