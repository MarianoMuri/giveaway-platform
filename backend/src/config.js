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
  reservationMinutes: Number(process.env.RESERVATION_MINUTES || 15),
  maxNumbersPerOrder: Number(process.env.MAX_NUMBERS_PER_ORDER || 50),
  mp: {
    accessToken: required('MP_ACCESS_TOKEN'),
    webhookSecret: process.env.MP_WEBHOOK_SECRET, // "Clave secreta" del panel de Webhooks de MP
  },
};
