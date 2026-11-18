const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config');

const sequelize = config.databaseUrl
  ? new Sequelize(config.databaseUrl, { logging: false })
  : new Sequelize({ dialect: 'sqlite', storage: process.env.SQLITE_PATH || ':memory:', logging: false });

const Raffle = sequelize.define('Raffle', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  prize: { type: DataTypes.STRING, allowNull: false },
  imageUrl: DataTypes.STRING,
  pricePerNumber: { type: DataTypes.DECIMAL(12, 2), allowNull: false }, // precio de 1 número
  promos: { type: DataTypes.JSON, defaultValue: [] }, // [{ qty: 2, price: 15000 }, ...]
  totalNumbers: { type: DataTypes.INTEGER, allowNull: false },
  drawDate: DataTypes.DATE,
  youtubeUrl: DataTypes.STRING,
  permitNumber: DataTypes.STRING, // N° de autorización de la lotería provincial
  terms: DataTypes.TEXT, // bases y condiciones
  status: {
    type: DataTypes.ENUM('draft', 'active', 'closed', 'drawn'),
    defaultValue: 'draft',
  },
  winnerNumber: DataTypes.INTEGER,
  // Oferta "Duplicá tus chances": se suma este precio por cada chance extra
  doubleEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  doublePricePerChance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  // Contador de números del sorteo: solo avanza (los anulados no se reutilizan)
  nextNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100000 },
});

const Pack = sequelize.define('Pack', {
  chances: { type: DataTypes.INTEGER, allowNull: false },
  price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
  featured: { type: DataTypes.BOOLEAN, defaultValue: false }, // "El más elegido"
  doubleEligible: { type: DataTypes.BOOLEAN, defaultValue: true }, // muestra la oferta "Duplicá" en este pack
});

const Course = sequelize.define('Course', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  coverUrl: DataTypes.STRING,
  pdfKey: { type: DataTypes.STRING, allowNull: false }, // key en el almacenamiento, nunca una ruta
  pdfName: { type: DataTypes.STRING, allowNull: false }, // nombre original para la descarga
  pdfSize: { type: DataTypes.INTEGER, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Order = sequelize.define('Order', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  buyerName: { type: DataTypes.STRING, allowNull: false },
  buyerEmail: { type: DataTypes.STRING, allowNull: false },
  buyerPhone: { type: DataTypes.STRING, allowNull: false },
  buyerDni: { type: DataTypes.STRING, allowNull: false },
  numbers: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }, // grilla (Sprint 0): copia para historial
  // Compra por pack: los números se asignan al confirmarse el pago, en un bloque consecutivo
  PackId: DataTypes.INTEGER, // referencia informativa (el pack se puede editar o borrar después)
  double: { type: DataTypes.BOOLEAN, defaultValue: false },
  chances: DataTypes.INTEGER,
  firstNumber: DataTypes.INTEGER,
  lastNumber: DataTypes.INTEGER,
  courseTitle: DataTypes.STRING, // copia: el curso puede cambiar de nombre
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  status: {
    // needs_review: pagó pero sus números ya no estaban disponibles -> revisar/reintegrar
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'expired', 'needs_review', 'manual'),
    defaultValue: 'pending',
  },
  expiresAt: DataTypes.DATE,
  mpPreferenceId: DataTypes.STRING,
  mpPaymentId: DataTypes.STRING,
  mpStatusDetail: DataTypes.STRING,
});

const Ticket = sequelize.define(
  'Ticket',
  {
    number: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('available', 'reserved', 'sold'), defaultValue: 'available' },
    reservedUntil: DataTypes.DATE,
  },
  { indexes: [{ unique: true, fields: ['RaffleId', 'number'] }, { fields: ['RaffleId', 'status'] }] }
);

Raffle.hasMany(Ticket);
Ticket.belongsTo(Raffle);
Raffle.hasMany(Order);
Order.belongsTo(Raffle);
Order.hasMany(Ticket);
Ticket.belongsTo(Order);

// Un número asignado. La restricción única es la red de seguridad: aunque hubiera
// un bug en la asignación, la base nunca acepta el mismo número dos veces en un sorteo.
const Chance = sequelize.define(
  'Chance',
  {
    number: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('valid', 'void'), defaultValue: 'valid' },
  },
  { indexes: [{ unique: true, fields: ['RaffleId', 'number'] }, { fields: ['OrderId'] }] }
);

Raffle.hasMany(Chance);
Chance.belongsTo(Raffle);
Order.hasMany(Chance);
Chance.belongsTo(Order);
Course.hasMany(Order);
Order.belongsTo(Course);

Raffle.hasMany(Pack, { onDelete: 'CASCADE' });
Pack.belongsTo(Raffle);

module.exports = { sequelize, Raffle, Order, Ticket, Course, Pack, Chance };
