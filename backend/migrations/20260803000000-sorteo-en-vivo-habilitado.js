'use strict';

// Permite al administrador habilitar o deshabilitar el botón de "Sorteo en vivo" de cada sorteo, para que
// quien opera la transmisión no abra uno equivocado. Los sorteos existentes quedan habilitados.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Raffles', 'liveEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Raffles', 'liveEnabled');
  },
};
