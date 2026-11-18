'use strict';

// Sprint 2 (v0.3.0): participación gratuita, anulaciones, cierre de ventas, sorteos y auditoría.
// Solo agrega: ninguna compra ni número existente se modifica ni se pierde.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, DATE, BOOLEAN, UUID, ENUM } = Sequelize;
    const id = { type: INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const timestamps = {
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    };
    const ref = (table, type = INTEGER) => ({
      type, allowNull: true, references: { model: table, key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
    });
    const pg = queryInterface.sequelize.getDialect() === 'postgres';

    // Sorteos: fecha de cierre de ventas y modalidad "sin obligación de compra"
    await queryInterface.addColumn('Raffles', 'salesCloseAt', DATE);
    await queryInterface.addColumn('Raffles', 'freeEntryEnabled', { type: BOOLEAN, defaultValue: true });

    // Compras: dos estados nuevos (reintegro y contracargo) y fecha/motivo de anulación
    if (pg) {
      await queryInterface.sequelize.query(`ALTER TYPE "enum_Orders_status" ADD VALUE IF NOT EXISTS 'refunded'`);
      await queryInterface.sequelize.query(`ALTER TYPE "enum_Orders_status" ADD VALUE IF NOT EXISTS 'charged_back'`);
    }
    await queryInterface.addColumn('Orders', 'voidedAt', DATE);
    await queryInterface.addColumn('Orders', 'voidReason', STRING);

    await queryInterface.addColumn('Chances', 'voidedAt', DATE);
    await queryInterface.addColumn('Chances', 'voidReason', STRING);

    await queryInterface.createTable('FreeEntries', {
      id,
      name: { type: STRING, allowNull: false },
      dni: { type: STRING, allowNull: false },
      email: { type: STRING, allowNull: false },
      status: { type: ENUM('unconfirmed', 'confirmed', 'void'), defaultValue: 'unconfirmed' },
      tokenHash: STRING,
      tokenExpiresAt: DATE,
      ipHash: STRING,
      deviceHash: STRING,
      number: INTEGER,
      confirmedAt: DATE,
      ...timestamps,
      RaffleId: ref('Raffles'),
    });
    // 1 número por DNI y por sorteo, garantizado por la base
    await queryInterface.addIndex('FreeEntries', ['RaffleId', 'dni'], { unique: true, name: 'free_entries__raffle_id_dni' });
    await queryInterface.addIndex('FreeEntries', ['tokenHash'], { name: 'free_entries_token_hash' });
    await queryInterface.addIndex('FreeEntries', ['RaffleId', 'ipHash'], { name: 'free_entries__raffle_id_ip_hash' });
    await queryInterface.addIndex('FreeEntries', ['RaffleId', 'deviceHash'], { name: 'free_entries__raffle_id_device_hash' });

    // Un número puede venir de una compra o de una participación gratuita
    await queryInterface.addColumn('Chances', 'FreeEntryId', ref('FreeEntries'));
    await queryInterface.addIndex('Chances', ['FreeEntryId'], { name: 'chances__free_entry_id' });

    await queryInterface.createTable('OrderEvents', {
      id,
      status: { type: STRING, allowNull: false },
      detail: STRING,
      mpPaymentId: STRING,
      ...timestamps,
      OrderId: ref('Orders', UUID),
    });
    await queryInterface.addIndex('OrderEvents', ['OrderId'], { name: 'order_events__order_id' });

    await queryInterface.createTable('Draws', {
      id,
      number: { type: INTEGER, allowNull: false },
      method: { type: ENUM('random', 'manual'), allowNull: false },
      validCount: INTEGER,
      position: INTEGER,
      actor: { type: STRING, allowNull: false },
      reason: STRING,
      supersededAt: DATE,
      ...timestamps,
      RaffleId: ref('Raffles'),
    });
    await queryInterface.addIndex('Draws', ['RaffleId'], { name: 'draws__raffle_id' });

    // Solo se agrega: no tiene updatedAt
    await queryInterface.createTable('AuditLogs', {
      id,
      actor: { type: STRING, allowNull: false },
      action: { type: STRING, allowNull: false },
      RaffleId: INTEGER,
      detail: TEXT,
      ip: STRING,
      createdAt: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('AuditLogs', ['createdAt'], { name: 'audit_logs_created_at' });
    await queryInterface.addIndex('AuditLogs', ['RaffleId'], { name: 'audit_logs__raffle_id' });
  },

  async down(queryInterface) {
    const pg = queryInterface.sequelize.getDialect() === 'postgres';
    for (const t of ['AuditLogs', 'Draws', 'OrderEvents']) await queryInterface.dropTable(t);
    await queryInterface.removeColumn('Chances', 'FreeEntryId');
    await queryInterface.dropTable('FreeEntries');
    await queryInterface.removeColumn('Chances', 'voidReason');
    await queryInterface.removeColumn('Chances', 'voidedAt');
    await queryInterface.removeColumn('Orders', 'voidReason');
    await queryInterface.removeColumn('Orders', 'voidedAt');
    await queryInterface.removeColumn('Raffles', 'freeEntryEnabled');
    await queryInterface.removeColumn('Raffles', 'salesCloseAt');
    if (pg) {
      for (const n of ['FreeEntries_status', 'Draws_method']) await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_${n}"`);
      // Los valores 'refunded' y 'charged_back' del ENUM no se pueden quitar en PostgreSQL sin recrear el tipo:
      // quedan definidos y sin uso (no afecta a los datos).
    }
  },
};
