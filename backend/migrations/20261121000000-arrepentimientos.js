'use strict';

// Solicitudes de arrepentimiento (Res. 424/2020): el comprador pide anular su compra con DNI y email.
// Quedan guardadas con su estado; devolver el dinero lo decide y lo ejecuta el administrador.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Withdrawals', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      OrderId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Orders', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, // vacío si no se encontró una compra con esos datos
      dni: { type: Sequelize.STRING(8), allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'pending' }, // pending | approved | rejected
      note: { type: Sequelize.STRING(500), allowNull: true }, // motivo si se rechaza
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Withdrawals', ['status']);
    await queryInterface.addIndex('Withdrawals', ['OrderId']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Withdrawals');
  },
};
