'use strict';

// Aviso del ganador al administrador con cola de reintentos (como los comprobantes de compra):
// cada sorteo guarda si su aviso está pendiente, enviado o fallido. Solo agrega columnas.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, INTEGER, DATE } = Sequelize;
    await queryInterface.addColumn('Draws', 'alertStatus', { type: STRING(10), allowNull: false, defaultValue: 'none' });
    await queryInterface.addColumn('Draws', 'alertAttempts', { type: INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('Draws', 'alertNextAttemptAt', { type: DATE, allowNull: true });
    await queryInterface.addColumn('Draws', 'alertSentAt', { type: DATE, allowNull: true });
    await queryInterface.addColumn('Draws', 'alertLastError', { type: STRING(500), allowNull: true });
  },

  async down(queryInterface) {
    for (const c of ['alertLastError', 'alertSentAt', 'alertNextAttemptAt', 'alertAttempts', 'alertStatus']) {
      await queryInterface.removeColumn('Draws', c);
    }
  },
};
