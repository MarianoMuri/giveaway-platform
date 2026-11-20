const { fn, col } = require('sequelize');
const { Order, FreeEntry } = require('../db');
const { PROVINCES } = require('./provinces');

// "Dónde compran": compras, chances y recaudación por provincia (la que cada persona eligió al comprar),
// más las participaciones gratuitas confirmadas. Sirve para decidir dónde hacer publicidad.
// Solo cuentan compras acreditadas (online o manuales); las anuladas, pendientes o rechazadas no.
// Las compras anteriores a que existiera el campo provincia quedan en "Sin dato".
const SOLD = ['approved', 'manual'];
const nameOf = (code) => (code ? PROVINCES.find((p) => p.code === code)?.name || code : 'Sin dato');

async function bySalesProvince(raffleId) {
  const [orders, free] = await Promise.all([
    Order.findAll({
      where: { RaffleId: raffleId, status: SOLD },
      attributes: ['buyerProvince', [fn('COUNT', col('id')), 'purchases'], [fn('SUM', col('chances')), 'chances'], [fn('SUM', col('amount')), 'revenue']],
      group: ['buyerProvince'],
      raw: true,
    }),
    FreeEntry.findAll({
      where: { RaffleId: raffleId, status: 'confirmed' },
      attributes: ['province', [fn('COUNT', col('id')), 'entries']],
      group: ['province'],
      raw: true,
    }),
  ]);
  const rows = new Map();
  const row = (code) => {
    const key = code || '';
    if (!rows.has(key)) rows.set(key, { code: code || null, name: nameOf(code), purchases: 0, chances: 0, revenue: 0, freeEntries: 0 });
    return rows.get(key);
  };
  for (const o of orders) {
    const r = row(o.buyerProvince);
    r.purchases += Number(o.purchases);
    r.chances += Number(o.chances || 0);
    r.revenue += Number(o.revenue || 0);
  }
  for (const f of free) row(f.province).freeEntries += Number(f.entries);
  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.freeEntries - a.freeEntries || a.name.localeCompare(b.name));
  const totalRevenue = list.reduce((n, r) => n + r.revenue, 0);
  return { provinces: list.map((r) => ({ ...r, share: totalRevenue ? r.revenue / totalRevenue : 0 })), totalRevenue };
}

module.exports = { bySalesProvince };
