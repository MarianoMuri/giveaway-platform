'use strict';

// Promos por sorteo (descuento en %, chances de regalo), con código o automáticas, que el administrador
// enciende y apaga cuando quiere. Las compras guardan una copia de la promo usada: si después se edita
// o se borra la promo, el historial no cambia.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, INTEGER, BOOLEAN, DATE, DECIMAL } = Sequelize;
    await queryInterface.createTable('Promos', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      RaffleId: { type: INTEGER, allowNull: false, references: { model: 'Raffles', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: STRING(80), allowNull: false },
      kind: { type: STRING(10), allowNull: false }, // 'percent' | 'bonus'
      value: { type: INTEGER, allowNull: false }, // % de descuento o cantidad de chances de regalo
      minChances: { type: INTEGER, allowNull: false, defaultValue: 0 }, // mínimo de chances de la compra para que aplique
      code: STRING(30), // vacío = automática para todos
      enabled: { type: BOOLEAN, allowNull: false, defaultValue: false },
      startsAt: DATE,
      endsAt: DATE,
      maxUses: INTEGER,
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('Promos', ['RaffleId', 'code'], { unique: true, name: 'promos__raffle_id_code' });

    await queryInterface.addColumn('Orders', 'PromoId', { type: INTEGER, allowNull: true });
    await queryInterface.addColumn('Orders', 'promoName', { type: STRING(80), allowNull: true });
    await queryInterface.addColumn('Orders', 'promoCode', { type: STRING(30), allowNull: true });
    await queryInterface.addColumn('Orders', 'discount', { type: DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('Orders', 'bonusChances', { type: INTEGER, allowNull: false, defaultValue: 0 });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Orders', 'bonusChances');
    await queryInterface.removeColumn('Orders', 'discount');
    await queryInterface.removeColumn('Orders', 'promoCode');
    await queryInterface.removeColumn('Orders', 'promoName');
    await queryInterface.removeColumn('Orders', 'PromoId');
    await queryInterface.dropTable('Promos');
  },
};
