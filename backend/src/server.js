const app = require('./app');
const config = require('./config');
const { sequelize } = require('./db');

(async () => {
  // Para producción conviene pasar a migraciones (sequelize-cli). sync() alcanza para arrancar.
  await sequelize.sync();
  app.listen(config.port, () => console.log(`API escuchando en :${config.port}`));
})();
