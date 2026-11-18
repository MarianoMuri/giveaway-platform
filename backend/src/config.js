require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === 'production') {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return v;
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL, // postgres://user:pass@host:5432/db
  jwtSecret: required('JWT_SECRET') || 'dev-secret-cambiar',
  admin: {
    email: required('ADMIN_EMAIL') || 'admin@local',
    // Hash bcrypt de la contraseña: node -e "console.log(require('bcryptjs').hashSync('tuClave',10))"
    passwordHash: required('ADMIN_PASSWORD_HASH') || '',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  publicApiUrl: process.env.PUBLIC_API_URL || 'http://localhost:4000',
  storageDir: process.env.STORAGE_DIR || './storage',
  maxPdfMb: Number(process.env.MAX_PDF_MB || 20),
  downloadLinkHours: Number(process.env.DOWNLOAD_LINK_HOURS || 72),
  // Email transaccional. Sin SMTP_URL los mails se muestran en la consola (desarrollo).
  // Ej: smtps://resend:API_KEY@smtp.resend.com:465 · smtp://usuario:clave@smtp-relay.brevo.com:587
  mail: {
    smtpUrl: process.env.SMTP_URL,
    from: process.env.MAIL_FROM || 'Sorteos <no-responder@localhost>',
    replyTo: process.env.MAIL_REPLY_TO,
  },
  // Marca en los emails (el frontend tiene su propio brand.js)
  brand: {
    name: process.env.BRAND_NAME || 'AUTO SORTEOS',
    color: process.env.BRAND_COLOR || '#e3262f',
    logoUrl: process.env.BRAND_LOGO_URL || '',
    whatsapp: process.env.BRAND_WHATSAPP_URL || '',
  },
  mp: {
    accessToken: required('MP_ACCESS_TOKEN'),
    webhookSecret: process.env.MP_WEBHOOK_SECRET, // "Clave secreta" del panel de Webhooks de MP
  },
};
