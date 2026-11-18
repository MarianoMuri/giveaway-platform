// Configuración de conexión para sequelize-cli (migraciones y seeds).
// Usa la misma variable que la API: DATABASE_URL en producción; sin ella, un archivo SQLite local.
require('dotenv').config({ quiet: true });

module.exports = process.env.DATABASE_URL
  ? { url: process.env.DATABASE_URL, dialect: 'postgres', logging: false }
  : { dialect: 'sqlite', storage: process.env.SQLITE_PATH || './dev.sqlite', logging: false };
