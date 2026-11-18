// Servicio de envío de emails: corre aparte de la API para que un pico de compras no la afecte.
// Usa las mismas variables de entorno y la misma base. Si hubiera dos copias corriendo no se duplican
// mails: cada envío se "toma" con un UPDATE condicional (ver services/emails.js).
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
    const pending = await pendingMigrations(sequelize);
    if (pending.length) {
      console.error(`Faltan migraciones por aplicar (${pending.join(', ')}). Las aplica el deploy de la API.`);
      process.exit(1);
    }
  } else {
    await sequelize.sync();
  }
  const worker = emails.startWorker();
  console.log(`Worker de emails: lotes de ${config.email.batchSize}, ${config.email.concurrency} en paralelo, ${config.email.ratePerSecond || 'sin límite de'} por segundo`);

  const shutdown = async () => {
    worker.stop();
    await sequelize.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();
