// Promos por cantidad: [{ qty: 2, price: 15000 }, { qty: 5, price: 30000 }]
// Calcula el total más barato combinando promos y números sueltos.
// Mismo código que backend/src/services/pricing.js: si cambiás uno, cambiá el otro.

function normalizePromos(unitPrice, promos) {
  const list = [{ qty: 1, price: Number(unitPrice) }];
  for (const p of promos || []) {
    const qty = Number(p.qty);
    const price = Number(p.price);
    if (Number.isInteger(qty) && qty > 1 && price > 0) list.push({ qty, price });
  }
  return list;
}

export function computeTotal(unitPrice, promos, n) {
  const tiers = normalizePromos(unitPrice, promos);
  const cost = new Array(n + 1).fill(Infinity);
  const pick = new Array(n + 1).fill(null);
  cost[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (const t of tiers) {
      if (t.qty <= i && cost[i - t.qty] + t.price < cost[i]) {
        cost[i] = cost[i - t.qty] + t.price;
        pick[i] = t;
      }
    }
  }
  const counts = new Map();
  for (let i = n; i > 0; i -= pick[i].qty) counts.set(pick[i], (counts.get(pick[i]) || 0) + 1);
  const packs = [...counts.entries()]
    .map(([t, count]) => ({ qty: t.qty, price: t.price, count }))
    .sort((a, b) => b.qty - a.qty);
  const total = Math.round(cost[n] * 100) / 100;
  return { total, packs, savings: Math.round((n * Number(unitPrice) - total) * 100) / 100 };
}

export function validatePromos(promos) {
  if (promos == null) return [];
  if (!Array.isArray(promos)) throw new Error('promos debe ser una lista');
  const clean = promos
    .map((p) => ({ qty: Number(p.qty), price: Number(p.price) }))
    .filter((p) => Number.isInteger(p.qty) && p.qty > 1 && p.price > 0);
  const seen = new Set();
  for (const p of clean) {
    if (seen.has(p.qty)) throw new Error(`Hay dos promos para ${p.qty} números`);
    seen.add(p.qty);
  }
  return clean.sort((a, b) => a.qty - b.qty);
}

