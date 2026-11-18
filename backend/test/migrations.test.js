const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { Sequelize } = require('sequelize');
const config = require('../src/config');
const { sequelize: modelsDb } = require('../src/db');
const { migrationFiles, pendingMigrations } = require('../src/services/schema');

const isPg = !!config.databaseUrl;
// En PostgreSQL los tipos ENUM son globales de la base, así que el esquema aislado no alcanza:
// las migraciones se prueban en una base temporal propia (y se borra al terminar).
const TEMP_DB = `giveaway_mig_${process.pid}`;
const tempUrl = () => {
  const u = new URL(config.databaseUrl);
  u.pathname = `/${TEMP_DB}`;
  return u.toString();
};

async function freshDb() {
  if (isPg) {
    await modelsDb.query(`DROP DATABASE IF EXISTS "${TEMP_DB}" WITH (FORCE)`);
    await modelsDb.query(`CREATE DATABASE "${TEMP_DB}"`);
  }
  if (!isPg) return new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  return new Sequelize(tempUrl(), { logging: false });
}

async function migrate(db, files, direction) {
  const qi = db.getQueryInterface();
  for (const f of files) {
    const m = require(path.join(__dirname, '..', 'migrations', f));
    await m[direction](qi, Sequelize);
  }
}

async function describeAll(db) {
  const qi = db.getQueryInterface();
  const out = {};
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName)).filter((t) => t !== 'SequelizeMeta' && !t.startsWith('sqlite_'));
  for (const t of tables.sort()) {
    const cols = await qi.describeTable(t);
    const indexes = (await qi.showIndex(t))
      .filter((i) => !i.primary && !String(i.name).startsWith('sqlite_autoindex'))
      .map((i) => `${i.unique ? 'U ' : ''}${i.fields.map((f) => f.attribute).join(',')}`)
      .sort();
    const fks = (await qi.getForeignKeyReferencesForTable(t)).map((r) => `${r.columnName}->${r.referencedTableName}.${r.referencedColumnName}`).sort();
    out[t] = {
      columns: Object.fromEntries(Object.entries(cols).map(([c, d]) => [c, {
        type: String(d.type).replace(/\(\d+\)/, '').toUpperCase().replace('CHARACTER VARYING', 'VARCHAR').replace('TIMESTAMP WITH TIME ZONE', 'DATETIME').replace('ENUM', 'TEXT'),
        // Una clave primaria nunca es nula (SQLite no lo declara en las UUID creadas por sync)
        allowNull: d.primaryKey ? false : d.allowNull,
        primaryKey: !!d.primaryKey,
      }])),
      indexes,
      fks,
    };
  }
  return out;
}

// Diferencias legibles entre dos esquemas (en vez de un volcado enorme de deepEqual)
function diffSchemas(a, b) {
  const out = [];
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[t] || !b[t]) { out.push(`${t}: solo existe en ${a[t] ? 'migraciones' : 'modelos'}`); continue; }
    for (const c of new Set([...Object.keys(a[t].columns), ...Object.keys(b[t].columns)])) {
      const x = JSON.stringify(a[t].columns[c]);
      const y = JSON.stringify(b[t].columns[c]);
      if (x !== y) out.push(`${t}.${c}: migraciones=${x} modelos=${y}`);
    }
    for (const k of ['indexes', 'fks']) {
      if (JSON.stringify(a[t][k]) !== JSON.stringify(b[t][k])) out.push(`${t} ${k}: migraciones=${JSON.stringify(a[t][k])} modelos=${JSON.stringify(b[t][k])}`);
    }
  }
  return out;
}

test.after(async () => {
  if (isPg) await modelsDb.query(`DROP DATABASE IF EXISTS "${TEMP_DB}" WITH (FORCE)`);
});

test.before(async () => {
  await modelsDb.sync();
});

test('las migraciones dejan el mismo esquema que los modelos (nadie olvida una migración)', async () => {
  const db = await freshDb();
  await migrate(db, migrationFiles(), 'up');
  const fromMigrations = await describeAll(db);
  await db.close();
  // El esquema de los modelos se mide en la base de la app (sin el esquema temporal)
  const fromModels = await describeAll(modelsDb);
  assert.deepEqual(diffSchemas(fromMigrations, fromModels), []);
});

test('migrar con datos: lo que ya había se conserva y las columnas nuevas quedan con su valor por defecto', async () => {
  const db = await freshDb();
  const files = migrationFiles();
  await migrate(db, files.slice(0, 1), 'up'); // esquema de la v0.2.0
  const now = new Date().toISOString();
  await db.query(`INSERT INTO "Raffles" (title, prize, status, "nextNumber", "createdAt", "updatedAt") VALUES ('Viejo', 'Auto', 'active', 100002, '${now}', '${now}')`);
  await db.query(`INSERT INTO "Orders" (id, "buyerName", "buyerEmail", "buyerPhone", "buyerDni", amount, status, "RaffleId", "createdAt", "updatedAt")
                  VALUES ('11111111-1111-4111-8111-111111111111', 'Ana', 'ana@test', '1', '30111222', 45000, 'approved', 1, '${now}', '${now}')`);
  await db.query(`INSERT INTO "Chances" (number, status, "RaffleId", "OrderId", "createdAt", "updatedAt") VALUES (100000, 'valid', 1, '11111111-1111-4111-8111-111111111111', '${now}', '${now}')`);

  await migrate(db, files.slice(1), 'up'); // Sprint 2 sobre una base con datos

  const [[raffle]] = await db.query(`SELECT title, "nextNumber", "freeEntryEnabled", "salesCloseAt" FROM "Raffles"`);
  assert.equal(raffle.title, 'Viejo');
  assert.equal(raffle.nextNumber, 100002);
  assert.ok(raffle.freeEntryEnabled === true || raffle.freeEntryEnabled === 1, 'la participación gratuita queda habilitada');
  assert.equal(raffle.salesCloseAt, null);
  const [[chance]] = await db.query(`SELECT number, status, "voidedAt", "FreeEntryId" FROM "Chances"`);
  assert.equal(Number(chance.number), 100000);
  assert.equal(chance.status, 'valid');
  assert.equal(chance.voidedAt, null);
  assert.equal(chance.FreeEntryId, null);
  const [[order]] = await db.query(`SELECT "buyerName", status FROM "Orders"`);
  assert.equal(order.buyerName, 'Ana');

  // Los estados nuevos ya se aceptan
  await db.query(`UPDATE "Orders" SET status = 'refunded'`);
  await db.close();
});

test('cada migración se puede deshacer y el esquema queda vacío', async () => {
  const db = await freshDb();
  const files = migrationFiles();
  await migrate(db, files, 'up');
  await migrate(db, [...files].reverse(), 'down');
  assert.deepEqual(await describeAll(db), {});
  await db.close();
});

test('pendingMigrations avisa cuando la base no tiene las migraciones aplicadas', async () => {
  const db = await freshDb();
  assert.deepEqual(await pendingMigrations(db), migrationFiles()); // sin tabla SequelizeMeta
  await db.query('CREATE TABLE "SequelizeMeta" (name VARCHAR(255) PRIMARY KEY)');
  const [first, ...rest] = migrationFiles();
  await db.query(`INSERT INTO "SequelizeMeta" (name) VALUES ('${first}')`);
  assert.deepEqual(await pendingMigrations(db), rest);
  await db.close();
});
