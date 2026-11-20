'use strict';

// Dos interruptores por sorteo, reversibles y sin borrar nada: ocultarlo de la lista del operador del sorteo
// en vivo y ocultarlo de la página de inicio pública. Los sorteos existentes quedan visibles.
module.exports = {
  async up(queryInterface, Sequelize) {
    const col = { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false };
    await queryInterface.addColumn('Raffles', 'liveHidden', col);
    await queryInterface.addColumn('Raffles', 'publicHidden', col);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Raffles', 'publicHidden');
    await queryInterface.removeColumn('Raffles', 'liveHidden');
  },
};
