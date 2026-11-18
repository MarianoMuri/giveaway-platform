// Backend simulado para la DEMO (REACT_APP_DEMO=true). Intercepta fetch a /api/*.
// Replica la lógica del backend real: reservas con vencimiento, pago, venta manual, ganador.

import brand from '../brand';
import { computeTotal, validatePromos } from '../pricing';

const RESERVATION_MS = 15 * 60 * 1000;
let nextRaffleId = 4;
let nextCourseId = 6;
const now = () => Date.now();

const demoCourse = (id, title, description, position) => ({
  id, title, description, coverUrl: '', active: true, position, pdfName: `${title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '-')}.pdf`, pdfSize: 1800000 + id * 210000, createdAt: new Date().toISOString(),
});

const db = {
  courses: [
    demoCourse(1, 'Cocina básica', 'Técnicas y recetas para arrancar en la cocina.', 1),
    demoCourse(2, 'Jardinería en casa', 'Huerta, plantas de interior y cuidados por estación.', 2),
    demoCourse(3, 'Carpintería inicial', 'Herramientas, uniones y un primer mueble paso a paso.', 3),
    demoCourse(4, 'Herrería', 'Corte, soldadura y terminaciones para proyectos simples.', 4),
    { ...demoCourse(5, 'Fotografía con el celular', 'Encuadre, luz y edición rápida.', 5), active: false },
  ],
  raffles: [
    {
      id: 1, title: 'Gran Sorteo Edición Premium', prize: 'Chevrolet Onix 0km',
      description: 'Sorteo en vivo por YouTube. Te llevás el auto patentado y listo para salir. ¡Participá desde cualquier lugar del país!',
      imageUrl: brand.logoUrl, pricePerNumber: '10000.00', promos: [{ qty: 2, price: 15000 }, { qty: 5, price: 30000 }, { qty: 10, price: 50000 }], totalNumbers: 1000,
      drawDate: (() => { const d = new Date(Date.now() + 20 * 86400000); d.setHours(21, 0, 0, 0); return d.toISOString(); })(), youtubeUrl: null,
      permitNumber: 'DEMO-2026-001', status: 'active', winnerNumber: null, createdAt: new Date().toISOString(),
      terms: 'DEMO: este texto es de ejemplo.\n\n1. Participan mayores de 18 años.\n2. El sorteo se realiza en vivo por YouTube en la fecha indicada.\n3. El ganador será contactado por teléfono y email.',
    },
    {
      id: 2, title: 'Sorteo de Primavera', prize: 'Fiat Cronos 0km', description: '',
      imageUrl: null, pricePerNumber: '2000.00', totalNumbers: 200, drawDate: new Date(Date.now() - 30 * 86400000).toISOString(),
      youtubeUrl: null, permitNumber: 'DEMO-2026-000', status: 'drawn', winnerNumber: 87, terms: '',
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
    {
      id: 3, title: 'Sorteo de Invierno', prize: 'Renault Kwid 0km', description: '',
      imageUrl: null, pricePerNumber: '3000.00', totalNumbers: 300, drawDate: new Date(Date.now() - 120 * 86400000).toISOString(),
      youtubeUrl: null, permitNumber: 'DEMO-2026-00A', status: 'drawn', winnerNumber: 214, terms: '',
      createdAt: new Date(Date.now() - 150 * 86400000).toISOString(),
    },
  ],
  tickets: {}, // raffleId -> [{status, reservedUntil, orderId}]
  orders: [],
};

function initTickets(r) {
  db.tickets[r.id] = Array.from({ length: r.totalNumbers }, () => ({ status: 'available', reservedUntil: 0, orderId: null }));
}
db.raffles.forEach(initTickets);

const names = ['Ana Gómez', 'Carlos Ruiz', 'Lucía Fernández', 'Martín Sosa', 'Paula Díaz', 'Jorge Molina', 'Sofía Herrera', 'Diego Castro'];
function seedOrder(raffleId, numbers, i, status = 'approved', minutesAgo = 60) {
  const r = db.raffles.find((x) => x.id === raffleId);
  const o = {
    id: crypto.randomUUID(), RaffleId: raffleId, buyerName: names[i % names.length], buyerEmail: `cliente${i}@ejemplo.com`,
    buyerPhone: `291 4${String(100000 + i * 7919).slice(0, 6)}`, buyerDni: String(25000000 + i * 123457),
    numbers, amount: computeTotal(r.pricePerNumber, r.promos, numbers.length).total.toFixed(2), status,
    mpPaymentId: status === 'approved' ? String(1300000000 + i) : null, mpStatusDetail: status === 'approved' ? 'accredited' : null,
    createdAt: new Date(now() - minutesAgo * 60000).toISOString(), expiresAt: null,
  };
  numbers.forEach((n) => { db.tickets[raffleId][n - 1] = { status: 'sold', reservedUntil: 0, orderId: o.id }; });
  db.orders.push(o);
}
// Datos de ejemplo
let seed = 1;
for (let i = 0; i < 60; i++) {
  const nums = [];
  const count = 1 + (seed % 4);
  for (let k = 0; k < count; k++) { seed = (seed * 9301 + 49297) % 233280; nums.push(1 + (seed % 1000)); }
  const uniq = [...new Set(nums)].filter((n) => db.tickets[1][n - 1].status === 'available');
  if (uniq.length) seedOrder(1, uniq.sort((a, b) => a - b), i, i % 9 === 0 ? 'manual' : 'approved', 60 * 24 * 5 - i * 100);
}
seedOrder(2, [87, 12, 140], 3);
seedOrder(3, [214, 9], 5);
// Una reserva en curso de otra persona
(() => {
  const o = { id: crypto.randomUUID(), RaffleId: 1, buyerName: 'Comprador en curso', buyerEmail: 'x@ejemplo.com', buyerPhone: '-', buyerDni: '-', numbers: [5, 6], amount: '15000.00', status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(now() + RESERVATION_MS).toISOString() };
  [5, 6].forEach((n) => { db.tickets[1][n - 1] = { status: 'reserved', reservedUntil: now() + RESERVATION_MS, orderId: o.id }; });
  db.orders.push(o);
})();

const isFree = (t) => t.status === 'available' || (t.status === 'reserved' && t.reservedUntil < now());

function expire() {
  db.orders.filter((o) => o.status === 'pending' && new Date(o.expiresAt).getTime() < now()).forEach((o) => {
    db.tickets[o.RaffleId].forEach((t) => { if (t.orderId === o.id && t.status === 'reserved') Object.assign(t, { status: 'available', reservedUntil: 0, orderId: null }); });
    o.status = 'expired';
  });
}

class Err { constructor(status, body) { this.status = status; this.body = body; } }
const pub = (r) => { const { createdAt, ...rest } = r; return rest; };
const raffleOr404 = (id) => { const r = db.raffles.find((x) => String(x.id) === String(id)); if (!r) throw new Err(404, { error: 'Sorteo no encontrado' }); return r; };


// ---- Packs (demo): mismo comportamiento que backend/src/services/packs.js ----
const DEFAULT_PACKS = [[5, 15000], [10, 25000], [20, 45000, true], [30, 60000], [50, 90000], [100, 130000]];
let nextPackId = 1;
const packStore = {};
function packConfig(raffleId) {
  if (!packStore[raffleId]) {
    packStore[raffleId] = {
      offer: { enabled: true, pricePerChance: 1000 },
      packs: DEFAULT_PACKS.map(([chances, price, featured], i) => ({ id: nextPackId++, chances, price, position: i, featured: !!featured, doubleEligible: true })),
    };
  }
  return packStore[raffleId];
}
const packQuote = (p, offer, double) => {
  const extra = double ? p.chances * Math.round(offer.pricePerChance * 100) : 0;
  return { packId: p.id, chances: p.chances * (double ? 2 : 1), packPrice: p.price, double, doubleExtra: extra / 100, total: (Math.round(p.price * 100) + extra) / 100 };
};
const packPreview = ({ packs, offer }) => packs.map((p) => ({
  id: p.id, chances: p.chances, price: p.price, featured: p.featured, position: p.position,
  double: offer.enabled && p.doubleEligible ? packQuote(p, offer, true) : null,
}));
const adminPacks = (c) => ({ packs: c.packs, offer: c.offer, preview: packPreview(c) });
function savePacks(raffleId, body) {
  const packs = body.packs || [];
  const bad = (m) => { throw new Err(400, { error: m }); };
  if (!packs.length) bad('Tiene que haber al menos un pack');
  const seen = new Set();
  packs.forEach((p, i) => {
    if (!Number.isInteger(p.chances) || p.chances < 1 || p.chances > 10000) bad(`Pack ${i + 1}: la cantidad de chances debe ser un entero entre 1 y 10000`);
    if (!(p.price > 0)) bad(`Pack ${i + 1}: el precio debe ser mayor a 0`);
    if (seen.has(p.chances)) bad(`Hay dos packs de ${p.chances} chances`);
    seen.add(p.chances);
  });
  if (packs.filter((p) => p.featured).length > 1) bad('Solo un pack puede ser "El más elegido"');
  const offer = { enabled: !!body.offer?.enabled, pricePerChance: Number(body.offer?.pricePerChance) || 0 };
  if (offer.enabled && !(offer.pricePerChance > 0)) bad('Indicá el precio por chance extra de "Duplicá"');
  if (offer.enabled && !packs.some((p) => p.doubleEligible)) bad('"Duplicá" está activa pero no aparece en ningún pack');
  packStore[raffleId] = { offer, packs: packs.map((p, i) => ({ ...p, id: p.id || nextPackId++, position: i, featured: !!p.featured, doubleEligible: p.doubleEligible !== false })) };
  return adminPacks(packStore[raffleId]);
}

const routes = [
  ['GET', /^\/raffles$/, () => db.raffles.filter((r) => r.status !== 'draft').map(pub)],
  ['GET', /^\/raffles\/(\d+)$/, ([id]) => { const r = raffleOr404(id); if (r.status === 'draft') throw new Err(404, { error: 'Sorteo no encontrado' }); return pub(r); }],
  ['GET', /^\/raffles\/(\d+)\/numbers$/, ([id]) => ({
    grid: db.tickets[raffleOr404(id).id].map((t) => (t.status === 'sold' ? 2 : t.status === 'reserved' && t.reservedUntil > now() ? 1 : 0)),
  })],
  ['POST', /^\/orders$/, (_, body) => {
    const r = raffleOr404(body.raffleId);
    if (r.status !== 'active') throw new Err(404, { error: 'Sorteo no disponible' });
    const nums = [...new Set(body.numbers.map(Number))];
    const tk = db.tickets[r.id];
    const unavailable = nums.filter((n) => !tk[n - 1] || !isFree(tk[n - 1]));
    if (unavailable.length) throw new Err(409, { error: 'Algunos números ya no están disponibles', unavailable });
    const b = body.buyer;
    const o = {
      id: crypto.randomUUID(), RaffleId: r.id, buyerName: b.name, buyerEmail: b.email, buyerPhone: b.phone, buyerDni: b.dni,
      numbers: nums.sort((a, c) => a - c), amount: computeTotal(r.pricePerNumber, r.promos, nums.length).total.toFixed(2), status: 'pending',
      createdAt: new Date().toISOString(), expiresAt: new Date(now() + RESERVATION_MS).toISOString(),
    };
    nums.forEach((n) => { tk[n - 1] = { status: 'reserved', reservedUntil: now() + RESERVATION_MS, orderId: o.id }; });
    db.orders.unshift(o);
    return { orderId: o.id, checkoutUrl: `/demo-pago/${o.id}`, expiresAt: o.expiresAt };
  }],
  ['GET', /^\/orders\/([\w-]+)$/, ([id]) => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new Err(404, { error: 'Compra no encontrada' });
    return o;
  }],
  // Simulación del aviso de pago (lo que en producción hace el webhook de Mercado Pago)
  ['POST', /^\/demo\/pay\/([\w-]+)$/, ([id], body) => {
    const o = db.orders.find((x) => x.id === id);
    if (!o || o.status !== 'pending') return o;
    if (body.result === 'approved') {
      db.tickets[o.RaffleId].forEach((t) => { if (t.orderId === o.id) Object.assign(t, { status: 'sold', reservedUntil: 0 }); });
      Object.assign(o, { status: 'approved', mpPaymentId: 'DEMO-' + Math.floor(Math.random() * 1e9), mpStatusDetail: 'accredited' });
    } else {
      db.tickets[o.RaffleId].forEach((t) => { if (t.orderId === o.id) Object.assign(t, { status: 'available', reservedUntil: 0, orderId: null }); });
      Object.assign(o, { status: 'rejected', mpStatusDetail: 'cc_rejected_insufficient_amount' });
    }
    return o;
  }],
  ['POST', /^\/admin\/login$/, (_, b) => {
    if (b.email === 'demo@demo.com' && b.password === 'demo') return { token: 'demo-token' };
    throw new Err(401, { error: 'Credenciales inválidas (usá demo@demo.com / demo)' });
  }],
  ['GET', /^\/admin\/raffles$/, () => [...db.raffles].sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
  ['POST', /^\/admin\/raffles$/, (_, b) => {
    if (!Number.isInteger(b.totalNumbers) || b.totalNumbers < 1 || b.totalNumbers > 100000) throw new Err(400, { error: 'totalNumbers debe ser entre 1 y 100000' });
    let promos;
    try { promos = validatePromos(b.promos); } catch (e) { throw new Err(400, { error: e.message }); }
    const r = { ...b, promos, id: nextRaffleId++, pricePerNumber: Number(b.pricePerNumber).toFixed(2), status: b.status || 'draft', winnerNumber: null, createdAt: new Date().toISOString() };
    db.raffles.push(r);
    initTickets(r);
    return r;
  }],
  ['PATCH', /^\/admin\/raffles\/(\d+)$/, ([id], b) => {
    if ('promos' in b) { try { b.promos = validatePromos(b.promos); } catch (e) { throw new Err(400, { error: e.message }); } }
    return Object.assign(raffleOr404(id), b);
  }],
  ['POST', /^\/admin\/raffles\/(\d+)\/winner$/, ([id], b) => {
    const r = raffleOr404(id);
    const t = db.tickets[r.id][Number(b.number) - 1];
    if (!t) throw new Err(400, { error: 'Número fuera de rango' });
    Object.assign(r, { winnerNumber: Number(b.number), status: 'drawn' });
    const o = t.status === 'sold' && db.orders.find((x) => x.id === t.orderId);
    return { number: Number(b.number), sold: t.status === 'sold', winner: o ? { name: o.buyerName, phone: o.buyerPhone, email: o.buyerEmail, dni: o.buyerDni } : null };
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/stats$/, ([id]) => {
    const r = raffleOr404(id);
    const byStatus = { available: 0, reserved: 0, sold: 0 };
    db.tickets[r.id].forEach((t) => { byStatus[t.status === 'reserved' && t.reservedUntil < now() ? 'available' : t.status]++; });
    const revenue = db.orders.filter((o) => o.RaffleId === r.id && ['approved', 'manual'].includes(o.status)).reduce((a, o) => a + Number(o.amount), 0);
    return { byStatus, revenue };
  }],
  ['GET', /^\/admin\/orders$/, (_, __, q) => db.orders
    .filter((o) => (!q.get('raffleId') || String(o.RaffleId) === q.get('raffleId')) && (!q.get('status') || o.status === q.get('status')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
  ['POST', /^\/admin\/orders\/manual$/, (_, b) => {
    const r = raffleOr404(b.raffleId);
    const nums = [...new Set(b.numbers.map(Number))];
    const tk = db.tickets[r.id];
    if (nums.some((n) => !tk[n - 1] || !isFree(tk[n - 1]))) throw new Err(409, { error: 'Algunos números no están disponibles' });
    const o = {
      id: crypto.randomUUID(), RaffleId: r.id, buyerName: b.buyer.name, buyerEmail: '-', buyerPhone: b.buyer.phone || '-', buyerDni: b.buyer.dni || '-',
      numbers: nums.sort((a, c) => a - c), amount: computeTotal(r.pricePerNumber, r.promos, nums.length).total.toFixed(2), status: 'manual', createdAt: new Date().toISOString(),
    };
    nums.forEach((n) => { tk[n - 1] = { status: 'sold', reservedUntil: 0, orderId: o.id }; });
    db.orders.unshift(o);
    return o;
  }],
  ['GET', /^\/raffles\/(\d+)\/packs$/, ([id]) => {
    const r = raffleOr404(id);
    if (r.status === 'draft') throw new Err(404, { error: 'Sorteo no encontrado' });
    const c = packConfig(r.id);
    return { offer: c.offer, packs: packPreview(c) };
  }],
  ['POST', /^\/raffles\/(\d+)\/quote$/, ([id], b) => {
    const r = raffleOr404(id);
    if (r.status !== 'active') throw new Err(409, { error: 'El sorteo no está a la venta' });
    const c = packConfig(r.id);
    const p = c.packs.find((x) => x.id === Number(b.packId));
    if (!p) throw new Err(400, { error: 'Pack inválido' });
    if (b.double === true && !(c.offer.enabled && p.doubleEligible)) throw new Err(400, { error: 'La oferta "Duplicá" no está disponible para este pack' });
    return packQuote(p, c.offer, b.double === true);
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/packs$/, ([id]) => adminPacks(packConfig(raffleOr404(id).id))],
  ['PUT', /^\/admin\/raffles\/(\d+)\/packs$/, ([id], b) => savePacks(raffleOr404(id).id, b)],
  ['GET', /^\/courses$/, () => db.courses.filter((c) => c.active).sort((a, b) => a.position - b.position)
    .map(({ id, title, description, coverUrl, position }) => ({ id, title, description, coverUrl, position }))],
  ['GET', /^\/admin\/courses$/, () => [...db.courses].sort((a, b) => a.position - b.position)],
  ['POST', /^\/admin\/courses$/, (_, b) => {
    if (!b.title) throw new Err(400, { error: 'El título es obligatorio' });
    if (!b.pdf) throw new Err(400, { error: 'Falta el archivo PDF' });
    const c = { id: nextCourseId++, title: b.title, description: b.description || '', coverUrl: b.coverUrl || '', active: b.active !== 'false',
      position: Number(b.position) || 0, pdfName: b.pdf.name, pdfSize: b.pdf.size, createdAt: new Date().toISOString() };
    db.courses.push(c);
    return c;
  }],
  ['PATCH', /^\/admin\/courses\/(\d+)$/, ([id], b) => {
    const c = db.courses.find((x) => String(x.id) === id);
    if (!c) throw new Err(404, { error: 'Curso no encontrado' });
    for (const k of ['title', 'description', 'coverUrl']) if (b[k] !== undefined) c[k] = b[k];
    if (b.active !== undefined) c.active = b.active === true || b.active === 'true';
    if (b.position !== undefined) c.position = Number(b.position) || 0;
    if (b.pdf) Object.assign(c, { pdfName: b.pdf.name, pdfSize: b.pdf.size });
    return c;
  }],
  ['DELETE', /^\/admin\/courses\/(\d+)$/, ([id]) => {
    db.courses = db.courses.filter((x) => String(x.id) !== id);
    return {};
  }],
  ['POST', /^\/admin\/courses\/(\d+)\/download-link$/, () => {
    throw new Err(400, { error: 'En la demo no hay archivos reales para descargar' });
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/export\.csv$/, ([id]) => {
    const rows = db.orders.filter((o) => String(o.RaffleId) === id && ['approved', 'manual'].includes(o.status));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return { __csv: ['Fecha;Nombre;DNI;Teléfono;Email;Números;Monto;Estado;Pago MP',
      ...rows.map((o) => [o.createdAt, o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail, o.numbers.join(' '), o.amount, o.status, o.mpPaymentId].map(esc).join(';'))].join('\n') };
  }],
];

export function installMockApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const idx = url.pathname.indexOf('/api/');
    if (idx === -1) return realFetch(input, init);
    const path = url.pathname.slice(idx + 4);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init.body ? JSON.parse(init.body) : {};
    expire();
    await new Promise((r) => setTimeout(r, 150)); // latencia simulada
    for (const [m, re, fn] of routes) {
      const match = method === m && path.match(re);
      if (!match) continue;
      try {
        const data = fn(match.slice(1), body, url.searchParams);
        if (data && data.__csv) return new Response(data.__csv, { status: 200, headers: { 'Content-Type': 'text/csv' } });
        return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        if (e instanceof Err) return new Response(JSON.stringify(e.body), { status: e.status, headers: { 'Content-Type': 'application/json' } });
        throw e;
      }
    }
    return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });
  };
}
