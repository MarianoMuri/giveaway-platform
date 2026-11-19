const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config');
const { DEFAULT_EXCLUDED, parseCodes } = require('./services/provinces');
const { fixFilename } = require('./services/filename');

const sequelize = config.databaseUrl
  ? new Sequelize(config.databaseUrl, { logging: false })
  : new Sequelize({ dialect: 'sqlite', storage: process.env.SQLITE_PATH || ':memory:', logging: false });

const Raffle = sequelize.define('Raffle', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  prize: { type: DataTypes.STRING, allowNull: false },
  imageUrl: DataTypes.STRING,
  // Meta de chances (opcional): solo para la barra de progreso. No es un tope: la venta sigue.
  chancesGoal: DataTypes.INTEGER,
  drawDate: DataTypes.DATE,
  // Cierre de ventas (opcional): desde esa fecha no se compran más chances ni se suman participaciones
  salesCloseAt: DataTypes.DATE,
  youtubeUrl: DataTypes.STRING,
  permitNumber: DataTypes.STRING, // N° de autorización de la lotería provincial
  terms: DataTypes.TEXT, // bases y condiciones
  // Provincias donde el sorteo no se ofrece (códigos ISO, ej. "M,Q"). Por defecto, las que tienen régimen
  // propio para sorteos promocionales hasta que el trámite de cada una esté resuelto.
  excludedProvinces: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: DEFAULT_EXCLUDED.join(','),
    get() { return parseCodes(this.getDataValue('excludedProvinces')); },
    set(v) { this.setDataValue('excludedProvinces', parseCodes(v).join(',')); },
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'closed', 'drawn'),
    defaultValue: 'draft',
  },
  winnerNumber: DataTypes.INTEGER,
  // Modalidad "sin obligación de compra": cualquiera puede sumarse gratis con 1 número por DNI
  freeEntryEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
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
  pdfName: { // nombre original para la descarga; al leerlo se repara si quedó guardado con las tildes rotas
    type: DataTypes.STRING,
    allowNull: false,
    get() { return fixFilename(this.getDataValue('pdfName')); },
  },
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
  buyerProvince: DataTypes.STRING(2), // código de provincia (las compras anteriores no lo tienen)
  // Los números se asignan al confirmarse el pago, en un bloque consecutivo
  PackId: DataTypes.INTEGER, // referencia informativa (el pack se puede editar o borrar después)
  double: { type: DataTypes.BOOLEAN, defaultValue: false },
  chances: DataTypes.INTEGER,
  firstNumber: DataTypes.INTEGER,
  lastNumber: DataTypes.INTEGER,
  courseTitle: DataTypes.STRING, // copia: el curso puede cambiar de nombre
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  status: {
    // needs_review: pagó un monto distinto al de la orden -> revisar/reintegrar
    // rejected: no se pudo crear el pago en Mercado Pago
    // refunded / charged_back: pago devuelto o desconocido por el comprador -> sus números quedan anulados
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'needs_review', 'manual', 'refunded', 'charged_back'),
    defaultValue: 'pending',
  },
  // Email de confirmación (outbox): se marca "pending" en la misma transacción que aprueba
  // la compra, y un proceso aparte lo envía y reintenta con espera creciente.
  emailStatus: { type: DataTypes.ENUM('none', 'pending', 'sent', 'failed'), defaultValue: 'none' },
  emailAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  emailNextAttemptAt: DataTypes.DATE,
  emailSentAt: DataTypes.DATE,
  emailLastError: DataTypes.STRING(500),
  mpPreferenceId: DataTypes.STRING,
  mpPaymentId: DataTypes.STRING,
  mpStatusDetail: DataTypes.STRING,
  voidedAt: DataTypes.DATE,
  voidReason: DataTypes.STRING,
});

// Historial de estados de una compra: queda cuándo y por qué cambió, para poder explicarle
// al cliente (o a Mercado Pago ante un reclamo) qué pasó con cada pago.
const OrderEvent = sequelize.define(
  'OrderEvent',
  {
    status: { type: DataTypes.STRING, allowNull: false },
    detail: DataTypes.STRING,
    mpPaymentId: DataTypes.STRING,
  },
  { indexes: [{ fields: ['OrderId'] }] }
);

// Participación gratuita: 1 número por DNI y por sorteo, asignado recién al confirmar el email.
// Del IP y del dispositivo solo se guarda un hash: alcanza para limitar abusos sin conservar el dato.
const FreeEntry = sequelize.define(
  'FreeEntry',
  {
    name: { type: DataTypes.STRING, allowNull: false },
    dni: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    province: DataTypes.STRING(2), // código de provincia
    status: { type: DataTypes.ENUM('unconfirmed', 'confirmed', 'void'), defaultValue: 'unconfirmed' },
    tokenHash: DataTypes.STRING, // hash del link de confirmación (el link en sí solo viaja por email)
    tokenExpiresAt: DataTypes.DATE,
    ipHash: DataTypes.STRING,
    deviceHash: DataTypes.STRING,
    number: DataTypes.INTEGER,
    confirmedAt: DataTypes.DATE,
  },
  {
    indexes: [
      { unique: true, fields: ['RaffleId', 'dni'] }, // 1 número por DNI y por sorteo, garantizado por la base
      { fields: ['tokenHash'] },
      { fields: ['RaffleId', 'ipHash'] },
      { fields: ['RaffleId', 'deviceHash'] },
    ],
  }
);
Raffle.hasMany(FreeEntry);
FreeEntry.belongsTo(Raffle);

Raffle.hasMany(Order);
Order.belongsTo(Raffle);

// Un número asignado. La restricción única es la red de seguridad: aunque hubiera
// un bug en la asignación, la base nunca acepta el mismo número dos veces en un sorteo.
const Chance = sequelize.define(
  'Chance',
  {
    number: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('valid', 'void'), defaultValue: 'valid' },
    voidedAt: DataTypes.DATE,
    voidReason: DataTypes.STRING,
  },
  { indexes: [{ unique: true, fields: ['RaffleId', 'number'] }, { fields: ['OrderId'] }, { fields: ['FreeEntryId'] }] }
);

Raffle.hasMany(Chance);
Chance.belongsTo(Raffle);
// Cada sorteo realizado (o ganador cargado a mano). Un sorteo repetido no borra el anterior: lo marca
// como reemplazado y guarda el motivo. "validCount" y "position" permiten verificar el resultado:
// el ganador es el número que ocupa esa posición entre los válidos ordenados de menor a mayor.
const Draw = sequelize.define(
  'Draw',
  {
    number: { type: DataTypes.INTEGER, allowNull: false },
    method: { type: DataTypes.ENUM('random', 'manual'), allowNull: false },
    validCount: DataTypes.INTEGER,
    position: DataTypes.INTEGER,
    actor: { type: DataTypes.STRING, allowNull: false },
    reason: DataTypes.STRING,
    supersededAt: DataTypes.DATE,
  },
  { indexes: [{ fields: ['RaffleId'] }] }
);
Raffle.hasMany(Draw);
Draw.belongsTo(Raffle);

// Registro de auditoría: solo se agrega, no hay forma de editarlo ni borrarlo desde la API
const AuditLog = sequelize.define(
  'AuditLog',
  {
    actor: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    RaffleId: DataTypes.INTEGER,
    detail: DataTypes.TEXT,
    ip: DataTypes.STRING,
  },
  { updatedAt: false, indexes: [{ fields: ['createdAt'] }, { fields: ['RaffleId'] }] }
);

Order.hasMany(OrderEvent);
OrderEvent.belongsTo(Order);
Order.hasMany(Chance);
Chance.belongsTo(Order);
FreeEntry.hasMany(Chance);
Chance.belongsTo(FreeEntry);
Course.hasMany(Order);
Order.belongsTo(Course);

Raffle.hasMany(Pack, { onDelete: 'CASCADE' });
Pack.belongsTo(Raffle);

module.exports = { sequelize, Raffle, Order, Course, Pack, Chance, FreeEntry, OrderEvent, Draw, AuditLog };
