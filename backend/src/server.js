const app = require('./app');
const config = require('./config');
const { sequelize } = require('./db');
const { expireOrders } = require('./services/orders');

(async () => {
  // Para producción conviene pasar a migraciones (sequelize-cli). sync() alcanza para arrancar.
  await sequelize.sync();
  setInterval(() => expireOrders().catch((e) => console.error('expireOrders', e)), 60 * 1000);
  app.listen(config.port, () => console.log(`API escuchando en :${config.port}`));
})();
