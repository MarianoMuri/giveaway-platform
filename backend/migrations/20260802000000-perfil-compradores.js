'use strict';

// Localidad opcional de compradores y participantes gratuitos, para saber dónde hacer publicidad.
// Solo agrega una columna nula: ningún dato existente se modifica.
const COLS = (Sequelize) => ({
  locality: { type: Sequelize.STRING(80), allowNull: true },
});

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['Orders', 'FreeEntries']) {
      for (const [name, def] of Object.entries(COLS(Sequelize))) await queryInterface.addColumn(table, name, def);
    }
  },

  async down(queryInterface) {
    for (const table of ['FreeEntries', 'Orders']) {
      for (const name of ['locality']) await queryInterface.removeColumn(table, name);
    }
  },
};
