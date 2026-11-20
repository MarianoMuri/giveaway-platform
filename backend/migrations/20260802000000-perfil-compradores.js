'use strict';

// Localidad opcional de compradores y participantes gratuitos, para saber dónde hacer publicidad, y teléfono
// de los participantes gratuitos (para poder contactar al ganador). Solo agrega columnas nulas.
const COLS = (Sequelize) => ({
  locality: { type: Sequelize.STRING(80), allowNull: true },
});

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['Orders', 'FreeEntries']) {
      for (const [name, def] of Object.entries(COLS(Sequelize))) await queryInterface.addColumn(table, name, def);
    }
    await queryInterface.addColumn('FreeEntries', 'phone', { type: Sequelize.STRING(30), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('FreeEntries', 'phone');
    for (const table of ['FreeEntries', 'Orders']) {
      for (const name of ['locality']) await queryInterface.removeColumn(table, name);
    }
  },
};
