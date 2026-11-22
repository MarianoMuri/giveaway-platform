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
  // Las variantes de un mismo valor (con/sin tilde o mayúscula) se juntan; se muestra la más usada
  // y, si empatan, la escrita con mayúsculas (así no depende del orden en que devuelve la base).
  const best = new Map();
  const better = (v, c, cur) => !cur || c > cur.c || (c === cur.c && ((v !== v.toLowerCase() && cur.v === cur.v.toLowerCase()) || (v !== v.toLowerCase() === (cur.v !== cur.v.toLowerCase()) && v < cur.v)));
  for (const o of orders) {
    const raw = o[dim.order];
    if (!raw) continue;
    const k = norm(raw);
    const c = Number(o.purchases);
    if (better(raw, c, best.get(k))) best.set(k, { v: raw, c });
  }
  for (const o of orders) {
    const r = row(o[dim.order]);
    if (o[dim.order]) { const b = best.get(norm(o[dim.order])); r.code = b.v; r.name = dim.label(b.v); }
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
