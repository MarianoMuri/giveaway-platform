'use strict';

// Datos opcionales de compradores y participantes gratuitos para estadísticas: localidad, rango de edad,
// género y ocupación. Solo agrega columnas nulas: ningún dato existente se modifica.
const COLS = (Sequelize) => ({
  locality: { type: Sequelize.STRING(80), allowNull: true },
  ageRange: { type: Sequelize.STRING(10), allowNull: true },
  gender: { type: Sequelize.STRING(1), allowNull: true },
  occupation: { type: Sequelize.STRING(20), allowNull: true },
});

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['Orders', 'FreeEntries']) {
      for (const [name, def] of Object.entries(COLS(Sequelize))) await queryInterface.addColumn(table, name, def);
    }
  },

  async down(queryInterface) {
    for (const table of ['FreeEntries', 'Orders']) {
      for (const name of ['occupation', 'gender', 'ageRange', 'locality']) await queryInterface.removeColumn(table, name);
    }
  },
};
