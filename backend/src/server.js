const app = require('./app');
const config = require('./config');
const { sequelize } = require('./db');
const emails = require('./services/emails');
const mpHealth = require('./services/mpHealth');
const { pendingMigrations } = require('./services/schema');
const { productionProblems } = require('./productionCheck');

(async () => {
  if (process.env.NODE_ENV === 'production') {
    const problems = productionProblems();
    if (problems.length) {
      console.error(`Configuración de producción incompleta:\n - ${problems.join('\n - ')}`);
      process.exit(1);
    }
  }
  if (config.databaseUrl) {
    // Con PostgreSQL el esquema lo manejan las migraciones: la API no lo toca y no arranca si faltan.
    const pending = await pendingMigrations(sequelize);
    if (pending.length) {
      console.error(`Faltan migraciones por aplicar (${pending.join(', ')}). Corré: npm run migrate`);
      process.exit(1);
    }
  } else {
    // Desarrollo sin DATABASE_URL (SQLite): se crea el esquema solo, para arrancar sin pasos previos.
    await sequelize.sync();
  }
  // Envío de emails pendientes (outbox). En producción con volumen alto corre en un servicio aparte (src/worker.js)
  // y acá se apaga con EMAIL_WORKER=off.
  if (config.email.worker) emails.startWorker();
  mpHealth.start(); // chequeo periódico de la conexión con Mercado Pago
  app.listen(config.port, () => console.log(`API escuchando en :${config.port}`));
})();
