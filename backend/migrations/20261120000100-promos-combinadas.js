'use strict';

// Una promo ahora puede dar descuento Y chances de regalo a la vez (antes era una cosa o la otra).
// Las promos ya creadas se convierten sin perder nada: kind 'percent' pasa a `percent`, 'bonus' a `bonus`.

// SQLite recrea la tabla al quitar columnas y pierde los índices; en Postgres esto no hace nada.
async function asegurarIndice(queryInterface) {
  const idx = await queryInterface.showIndex('Promos');
  if (!idx.some((i) => i.name === 'promos__raffle_id_code')) {
    await queryInterface.addIndex('Promos', ['RaffleId', 'code'], { unique: true, name: 'promos__raffle_id_code' });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING } = Sequelize;
    await queryInterface.addColumn('Promos', 'percent', { type: INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('Promos', 'bonus', { type: INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.sequelize.query(`UPDATE "Promos" SET "percent" = "value" WHERE "kind" = 'percent'`);
    await queryInterface.sequelize.query(`UPDATE "Promos" SET "bonus" = "value" WHERE "kind" = 'bonus'`);
    await queryInterface.removeColumn('Promos', 'kind');
    await queryInterface.removeColumn('Promos', 'value');
    await asegurarIndice(queryInterface);
  },
  async down(queryInterface, Sequelize) {
    const { INTEGER, STRING } = Sequelize;
    await queryInterface.addColumn('Promos', 'kind', { type: STRING(10), allowNull: false, defaultValue: 'percent' });
    await queryInterface.addColumn('Promos', 'value', { type: INTEGER, allowNull: false, defaultValue: 1 });
    // Al volver atrás, una promo con las dos cosas conserva solo el descuento
    await queryInterface.sequelize.query(`UPDATE "Promos" SET "kind" = 'percent', "value" = "percent" WHERE "percent" > 0`);
    await queryInterface.sequelize.query(`UPDATE "Promos" SET "kind" = 'bonus', "value" = "bonus" WHERE "percent" = 0 AND "bonus" > 0`);
    await queryInterface.removeColumn('Promos', 'bonus');
    await queryInterface.removeColumn('Promos', 'percent');
    await asegurarIndice(queryInterface);
  },
};
