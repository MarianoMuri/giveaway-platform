// Todo lo de la marca está acá: nombre, textos, colores y links.
// Los links vacíos ('') no se muestran.
import logo from './assets/logo.jpg';

const brand = {
  name: 'AUTO SORTEOS',
  tagline: 'Sorteos en vivo por YouTube · Autos 0km',
  description:
    'Elegí tus números, pagá con Mercado Pago y seguí el sorteo en vivo. Todos los sorteos se transmiten en directo.',
  logoUrl: logo, // reemplazá src/assets/logo.jpg por el logo del cliente
  colors: {
    primary: '#e3262f', // color principal de la marca
    primaryText: '#ffffff',
    bg: '#0d0d0f',
    surface: '#18181c',
    text: '#f4f4f5',
    muted: '#a1a1aa',
  },
  // Reemplazá estos links por los perfiles reales. Si dejás uno vacío (''), no se muestra.
  social: {
    instagram: 'https://www.instagram.com/',
    youtube: 'https://www.youtube.com/',
    facebook: 'https://www.facebook.com/',
    whatsappChannel: '',
    tiktok: '',
    whatsappContact: '', // ej: https://wa.me/5492910000000 (botón "Escribinos")
  },
  // Botones extra de la página /links (además del sorteo activo y las redes)
  extraLinks: [
    // { label: 'Catálogo de usados', url: 'https://...' },
  ],
  location: '', // ej: 'Bahía Blanca, Buenos Aires'
};

export default brand;
