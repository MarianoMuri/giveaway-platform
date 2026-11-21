// Todo lo de la marca está acá: nombre, textos, colores y links.
// Los links vacíos ('') no se muestran.
import logo from './assets/logo.jpg';

// Cada dato se puede sobrescribir con una variable de Netlify (REACT_APP_BRAND_*), sin tocar el código:
// así la marca del cliente queda fuera del repositorio. Sin variable, vale el valor de acá.
const env = (name, fallback) => (process.env[`REACT_APP_BRAND_${name}`] || '').trim() || fallback;

const brand = {
  name: env('NAME', 'AUTO SORTEOS'),
  tagline: env('TAGLINE', 'Sorteos en vivo por redes sociales'),
  description: env(
    'DESCRIPTION',
    'Aprendé con un curso digital y participá de nuestros sorteos en vivo. Tus chances llegan al instante, con pago seguro por Mercado Pago.'
  ),
  logoUrl: env('LOGO_URL', logo), // link al logo del cliente (o reemplazá src/assets/logo.jpg)
  heroUrl: env('HERO_URL', ''), // imagen opcional debajo del título de la portada (link público); vacía = no se muestra
  colors: {
    primary: env('PRIMARY', '#e3262f'), // color principal de la marca
    primaryText: '#ffffff',
    bg: '#0d0d0f',
    surface: '#18181c',
    text: '#f4f4f5',
    muted: '#a1a1aa',
    offer: '#f5b301', // oferta "Duplicá tus chances": se diferencia del color principal
    offerText: '#1a1300',
  },
  // Reemplazá estos links por los perfiles reales. Si dejás uno vacío (''), no se muestra.
  social: {
    instagram: env('INSTAGRAM', 'https://www.instagram.com/'),
    youtube: env('YOUTUBE', 'https://www.youtube.com/'),
    facebook: env('FACEBOOK', 'https://www.facebook.com/'),
    whatsappChannel: env('WHATSAPP_CHANNEL', ''),
    tiktok: env('TIKTOK', ''),
    whatsappContact: env('WHATSAPP_CONTACT', ''), // ej: https://wa.me/5492910000000 (botón "Escribinos")
  },
  // Botones extra de la página /links (además del sorteo activo y las redes)
  extraLinks: [
    // { label: 'Catálogo de usados', url: 'https://...' },
  ],
  // Lugar habilitado del organizador. Si se completa, la compra y las bases dicen "Esta compra se realiza en ...".
  // Completar solo con el dato que confirme el abogado del cliente.
  location: process.env.REACT_APP_DEMO === 'true' ? 'Ciudad de ejemplo, Provincia (dato de la demo)' : '', // ej: 'Bahía Blanca, Buenos Aires'
};

export default brand;
