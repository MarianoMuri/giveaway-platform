'use strict';

// Provincias excluidas por sorteo y provincia de cada comprador / participante gratuito.
// Solo agrega columnas: ningún dato existente se modifica. Los sorteos que ya existían quedan con las
// provincias excluidas por defecto (las que tienen régimen propio para sorteos promocionales).
const DEFAULT_EXCLUDED = 'M,P,Y,Q,A,R,V';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT } = Sequelize;
    await queryInterface.addColumn('Raffles', 'excludedProvinces', { type: TEXT, allowNull: false, defaultValue: DEFAULT_EXCLUDED });
    await queryInterface.addColumn('Orders', 'buyerProvince', { type: STRING(2), allowNull: true });
    await queryInterface.addColumn('FreeEntries', 'province', { type: STRING(2), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('FreeEntries', 'province');
    await queryInterface.removeColumn('Orders', 'buyerProvince');
    await queryInterface.removeColumn('Raffles', 'excludedProvinces');
  },
};
