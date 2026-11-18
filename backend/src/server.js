const app = require('./app');
const config = require('./config');
const { sequelize } = require('./db');
const emails = require('./services/emails');
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
  // Reintentos de emails pendientes (outbox)
  setInterval(() => emails.processPending().catch((e) => console.error('[mail] processPending', e)), 60 * 1000);
  app.listen(config.port, () => console.log(`API escuchando en :${config.port}`));
})();
