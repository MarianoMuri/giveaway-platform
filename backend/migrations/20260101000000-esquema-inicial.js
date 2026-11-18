'use strict';

// Esquema de la versión 0.2.0 (Sprint 1): sorteos, packs, cursos, compras y números.
// Las tablas y columnas del Sprint 2 se agregan en la migración siguiente.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, DATE, BOOLEAN, DECIMAL, UUID, ENUM } = Sequelize;
    const id = { type: INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const timestamps = {
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    };
    const ref = (table, type = INTEGER, onDelete = 'SET NULL') => ({
      type, allowNull: true, references: { model: table, key: 'id' }, onUpdate: 'CASCADE', onDelete,
    });

    await queryInterface.createTable('Raffles', {
      id,
      title: { type: STRING, allowNull: false },
      description: TEXT,
      prize: { type: STRING, allowNull: false },
      imageUrl: STRING,
      chancesGoal: INTEGER,
      drawDate: DATE,
      youtubeUrl: STRING,
      permitNumber: STRING,
      terms: TEXT,
      status: { type: ENUM('draft', 'active', 'closed', 'drawn'), defaultValue: 'draft' },
      winnerNumber: INTEGER,
      doubleEnabled: { type: BOOLEAN, defaultValue: false },
      doublePricePerChance: { type: DECIMAL(12, 2), defaultValue: 0 },
      nextNumber: { type: INTEGER, allowNull: false, defaultValue: 100000 },
      ...timestamps,
    });

    await queryInterface.createTable('Courses', {
      id,
      title: { type: STRING, allowNull: false },
      description: TEXT,
      coverUrl: STRING,
      pdfKey: { type: STRING, allowNull: false },
      pdfName: { type: STRING, allowNull: false },
      pdfSize: { type: INTEGER, allowNull: false },
      active: { type: BOOLEAN, defaultValue: true },
      position: { type: INTEGER, defaultValue: 0 },
      ...timestamps,
    });

    await queryInterface.createTable('Packs', {
      id,
      chances: { type: INTEGER, allowNull: false },
      price: { type: DECIMAL(12, 2), allowNull: false },
      position: { type: INTEGER, defaultValue: 0 },
      featured: { type: BOOLEAN, defaultValue: false },
      doubleEligible: { type: BOOLEAN, defaultValue: true },
      ...timestamps,
      RaffleId: ref('Raffles', INTEGER, 'CASCADE'),
    });

    await queryInterface.createTable('Orders', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      buyerName: { type: STRING, allowNull: false },
      buyerEmail: { type: STRING, allowNull: false },
      buyerPhone: { type: STRING, allowNull: false },
      buyerDni: { type: STRING, allowNull: false },
      PackId: INTEGER,
      double: { type: BOOLEAN, defaultValue: false },
      chances: INTEGER,
      firstNumber: INTEGER,
      lastNumber: INTEGER,
      courseTitle: STRING,
      amount: { type: DECIMAL(12, 2), allowNull: false },
      status: { type: ENUM('pending', 'approved', 'rejected', 'needs_review', 'manual'), defaultValue: 'pending' },
      emailStatus: { type: ENUM('none', 'pending', 'sent', 'failed'), defaultValue: 'none' },
      emailAttempts: { type: INTEGER, defaultValue: 0 },
      emailNextAttemptAt: DATE,
      emailSentAt: DATE,
      emailLastError: STRING(500),
      mpPreferenceId: STRING,
      mpPaymentId: STRING,
      mpStatusDetail: STRING,
      ...timestamps,
      RaffleId: ref('Raffles'),
      CourseId: ref('Courses'),
    });

    await queryInterface.createTable('Chances', {
      id,
      number: { type: INTEGER, allowNull: false },
      status: { type: ENUM('valid', 'void'), defaultValue: 'valid' },
      ...timestamps,
      RaffleId: ref('Raffles'),
      OrderId: ref('Orders', UUID),
    });
    // Red de seguridad: la base nunca acepta el mismo número dos veces en un sorteo
    await queryInterface.addIndex('Chances', ['RaffleId', 'number'], { unique: true, name: 'chances__raffle_id_number' });
    await queryInterface.addIndex('Chances', ['OrderId'], { name: 'chances__order_id' });
  },

  async down(queryInterface) {
    for (const t of ['Chances', 'Orders', 'Packs', 'Courses', 'Raffles']) {
      await queryInterface.dropTable(t);
    }
    await dropEnums(queryInterface, ['Chances_status', 'Orders_emailStatus', 'Orders_status', 'Raffles_status']);
  },
};

// En PostgreSQL los ENUM son tipos aparte y sobreviven al DROP TABLE; en SQLite no existen.
async function dropEnums(queryInterface, names) {
  if (queryInterface.sequelize.getDialect() !== 'postgres') return;
  for (const n of names) await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_${n}"`);
}
