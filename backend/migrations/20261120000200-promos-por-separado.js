'use strict';

// Cada promo da UNA cosa (descuento o chances de regalo) y las promos se pueden juntar en una compra.
// - Promos.bonusEvery: las chances de regalo se dan "por cada X chances compradas" (antes era un número fijo).
// - Raffles.promoMode: si hay varias promos a la vez, se aplica la mayor ('best') o se suman ('sum').
// - Orders.PromoIds: todas las promos que se usaron en la compra (ej. "1,3"), para contar los usos de cada una.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING } = Sequelize;
    await queryInterface.addColumn('Promos', 'bonusEvery', { type: INTEGER, allowNull: false, defaultValue: 1 });
    await queryInterface.addColumn('Raffles', 'promoMode', { type: STRING(8), allowNull: false, defaultValue: 'best' });
    await queryInterface.addColumn('Orders', 'PromoIds', { type: STRING(120), allowNull: true });
    // Una promo que daba las dos cosas a la vez (versión anterior, nunca usada en serio) se queda solo con el descuento
    await queryInterface.sequelize.query(`UPDATE "Promos" SET "bonus" = 0 WHERE "percent" > 0 AND "bonus" > 0`);
    // Las promos de regalo que ya existían decían "N de regalo desde M chances": pasan a "N por cada M"
    await queryInterface.sequelize.query(
      `UPDATE "Promos" SET "bonusEvery" = CASE WHEN "minChances" > 1 THEN "minChances" ELSE 1 END WHERE "bonus" > 0`,
    );
    await queryInterface.sequelize.query(`UPDATE "Orders" SET "PromoIds" = CAST("PromoId" AS VARCHAR(20)) WHERE "PromoId" IS NOT NULL`);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Orders', 'PromoIds');
    await queryInterface.removeColumn('Raffles', 'promoMode');
    await queryInterface.removeColumn('Promos', 'bonusEvery');
    // SQLite recrea la tabla al quitar columnas y pierde el índice único; en Postgres esto no hace nada
    const idx = await queryInterface.showIndex('Promos');
    if (!idx.some((i) => i.name === 'promos__raffle_id_code')) {
      await queryInterface.addIndex('Promos', ['RaffleId', 'code'], { unique: true, name: 'promos__raffle_id_code' });
    }
  },
};
