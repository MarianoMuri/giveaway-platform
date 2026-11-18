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
  // Participación gratuita ("sin obligación de compra")
  freeEntries: {
    perIpPerDay: Number(process.env.FREE_ENTRIES_PER_IP_PER_DAY || 5), // varias personas pueden compartir IP (datos móviles, wifi)
    confirmHours: Number(process.env.FREE_ENTRY_CONFIRM_HOURS || 24),
    requestsPer15Min: Number(process.env.FREE_ENTRY_REQUESTS_PER_15_MIN || 20), // límite de la ruta por IP
  },
  // Compras iniciadas sin pago: hasta estas horas se consideran "en curso" (después, abandonadas)
  pendingGraceHours: Number(process.env.PENDING_GRACE_HOURS || 24),
  // Captcha Cloudflare Turnstile. Sin TURNSTILE_SECRET queda desactivado (desarrollo y tests).
  captcha: { secret: process.env.TURNSTILE_SECRET },
  // Envío de emails (outbox). El proveedor limita cuántos mails por segundo acepta: ajustar a su plan.
  email: {
    batchSize: Number(process.env.EMAIL_BATCH_SIZE || 50), // pendientes que se toman por vuelta
    concurrency: Number(process.env.EMAIL_CONCURRENCY || 5), // envíos en paralelo dentro del lote
    ratePerSecond: Number(process.env.EMAIL_RATE_PER_SEC ?? 5), // 0 = sin límite
    pollSeconds: Number(process.env.EMAIL_POLL_SECONDS || 5), // cada cuánto el worker busca pendientes
    worker: process.env.EMAIL_WORKER !== 'off', // 'off' en la API cuando el envío corre en un servicio aparte
    immediate: process.env.EMAIL_IMMEDIATE !== 'off', // intento de envío apenas se aprueba la compra
    immediateMaxWaitMs: 2000, // si el turno del envío inmediato tardaría más que esto (cola larga), lo toma el worker
  },
  // Monitor de la conexión con Mercado Pago: cada cuántos minutos se chequea y a quién se avisa
  // (por defecto, al email del administrador; ALERT_EMAILS acepta varios separados por coma)
  mpHealth: {
    intervalMin: Number(process.env.MP_HEALTH_INTERVAL_MIN || 5),
    alertEmails: (process.env.ALERT_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean),
  },
  mp: {
    accessToken: required('MP_ACCESS_TOKEN'),
    webhookSecret: process.env.MP_WEBHOOK_SECRET, // "Clave secreta" del panel de Webhooks de MP
  },
};
