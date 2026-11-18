const app = require('./app');
const config = require('./config');
const { sequelize } = require('./db');
const emails = require('./services/emails');

(async () => {
  // Para producción conviene pasar a migraciones (sequelize-cli). sync() alcanza para arrancar.
  await sequelize.sync();
  // Reintentos de emails pendientes (outbox)
  setInterval(() => emails.processPending().catch((e) => console.error('[mail] processPending', e)), 60 * 1000);
  app.listen(config.port, () => console.log(`API escuchando en :${config.port}`));
})();
