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
  numbers: { type: DataTypes.JSON, allowNull: false }, // copia para historial
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

module.exports = { sequelize, Raffle, Order, Ticket, Course };
