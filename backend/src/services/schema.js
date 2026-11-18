// Verifica que la base tenga aplicadas todas las migraciones del código.
// En producción el esquema lo cambian solo las migraciones (`npm run migrate`), nunca sync().
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
}

// Migraciones del código que la base todavía no aplicó. Si nunca se migró, devuelve todas.
async function pendingMigrations(sequelize) {
  const files = migrationFiles();
  let applied = [];
  try {
    const [rows] = await sequelize.query('SELECT name FROM "SequelizeMeta"');
    applied = rows.map((r) => r.name);
  } catch {
    // tabla inexistente: base sin migrar
  }
  return files.filter((f) => !applied.includes(f));
}

module.exports = { pendingMigrations, migrationFiles };
