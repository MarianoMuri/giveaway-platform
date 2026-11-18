'use strict';

// Datos de desarrollo: un sorteo activo con la escalera de packs sugerida.
// Solo para desarrollo: no correr en producción. Es idempotente (no duplica si ya existe).
const TITLE = 'Sorteo demo (desarrollo)';

module.exports = {
  async up(queryInterface) {
    const [exists] = await queryInterface.sequelize.query(`SELECT id FROM "Raffles" WHERE title = :title LIMIT 1`, {
      replacements: { title: TITLE },
    });
    if (exists.length) return;

    const now = new Date();
    await queryInterface.bulkInsert('Raffles', [{
      title: TITLE,
      description: 'Sorteo de ejemplo para probar el panel y el flujo de compra.',
      prize: '0 km a elección',
      status: 'active',
      doubleEnabled: true,
      doublePricePerChance: 1000,
      freeEntryEnabled: true,
      nextNumber: 100000,
      createdAt: now,
      updatedAt: now,
    }]);
    const [[raffle]] = await queryInterface.sequelize.query(`SELECT id FROM "Raffles" WHERE title = :title LIMIT 1`, {
      replacements: { title: TITLE },
    });

    const ladder = [[5, 15000], [10, 25000], [20, 45000], [30, 60000], [50, 90000], [100, 130000]];
    await queryInterface.bulkInsert('Packs', ladder.map(([chances, price], i) => ({
      chances, price, position: i, featured: chances === 20, doubleEligible: true,
      RaffleId: raffle.id, createdAt: now, updatedAt: now,
    })));
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "Packs" WHERE "RaffleId" IN (SELECT id FROM "Raffles" WHERE title = :title)`, { replacements: { title: TITLE } });
    await queryInterface.sequelize.query(`DELETE FROM "Raffles" WHERE title = :title`, { replacements: { title: TITLE } });
  },
};
