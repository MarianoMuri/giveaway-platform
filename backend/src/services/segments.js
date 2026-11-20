const { fn, col } = require('sequelize');
const { Order, FreeEntry } = require('../db');
const { PROVINCES } = require('./provinces');

// "Dónde compran": compras, chances y recaudación agrupadas por provincia o localidad, más las participaciones gratuitas confirmadas. Sirve para decidir dónde dirigir la publicidad.
// Solo cuentan compras acreditadas (online o manuales); las anuladas, pendientes o rechazadas no.
// Quien no completó el dato (es opcional, o la compra es anterior a que existiera) queda en "Sin dato".
const SOLD = ['approved', 'manual'];

// dimensión -> columna en compras y en participaciones gratuitas, y cómo mostrar el valor
const DIMENSIONS = {
  province: { order: 'buyerProvince', free: 'province', label: (v) => PROVINCES.find((p) => p.code === v)?.name || v },
  locality: { order: 'locality', free: 'locality', label: (v) => v },
};

// "Bahía Blanca" y "bahia blanca" son la misma localidad
const norm = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function segmentSales(raffleId, by = 'province') {
  const dim = DIMENSIONS[by];
  if (!dim) return null;
  const [orders, free] = await Promise.all([
    Order.findAll({
      where: { RaffleId: raffleId, status: SOLD },
      attributes: [dim.order, [fn('COUNT', col('id')), 'purchases'], [fn('SUM', col('chances')), 'chances'], [fn('SUM', col('amount')), 'revenue']],
      group: [dim.order],
      raw: true,
    }),
    FreeEntry.findAll({
      where: { RaffleId: raffleId, status: 'confirmed' },
      attributes: [dim.free, [fn('COUNT', col('id')), 'entries']],
      group: [dim.free],
      raw: true,
    }),
  ]);
  const rows = new Map();
  const row = (raw) => {
    const key = raw ? norm(raw) : '';
    if (!rows.has(key)) rows.set(key, { code: raw || null, name: raw ? dim.label(raw) : 'Sin dato', purchases: 0, chances: 0, revenue: 0, freeEntries: 0 });
    return rows.get(key);
  };
  for (const o of orders) {
    const r = row(o[dim.order]);
    r.purchases += Number(o.purchases);
    r.chances += Number(o.chances || 0);
    r.revenue += Number(o.revenue || 0);
  }
  for (const f of free) row(f[dim.free]).freeEntries += Number(f.entries);
  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.freeEntries - a.freeEntries || a.name.localeCompare(b.name));
  const totalRevenue = list.reduce((n, r) => n + r.revenue, 0);
  return { by, rows: list.map((r) => ({ ...r, share: totalRevenue ? r.revenue / totalRevenue : 0 })), totalRevenue };
}

module.exports = { segmentSales, DIMENSIONS };
