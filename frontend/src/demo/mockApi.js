// Backend simulado para la DEMO (REACT_APP_DEMO=true). Intercepta fetch a /api/*.
// Replica el comportamiento del backend real: packs, compra, pago, números consecutivos,
// venta manual y ganador. No hay servidor ni cobros reales.

import brand from '../brand';

let nextRaffleId = 4;
let nextCourseId = 6;
const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const DAY = 86400000;

const demoCourse = (id, title, description, position) => ({
  id, title, description, coverUrl: '', active: true, position, pdfName: `${title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '-')}.pdf`, pdfSize: 1800000 + id * 210000, createdAt: iso(),
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
      imageUrl: brand.logoUrl, chancesGoal: 10000, nextNumber: 100000,
      drawDate: (() => { const d = new Date(now() + 20 * DAY); d.setHours(21, 0, 0, 0); return d.toISOString(); })(), youtubeUrl: null,
      salesCloseAt: (() => { const d = new Date(now() + 18 * DAY); d.setHours(20, 0, 0, 0); return d.toISOString(); })(),
      permitNumber: 'DEMO-2026-001', status: 'active', winnerNumber: null, freeEntryEnabled: true, createdAt: iso(),
      terms: 'DEMO: este texto es de ejemplo.\n\n1. Participan mayores de 18 años.\n2. Cada compra incluye un curso digital y chances de regalo.\n3. El sorteo se realiza en vivo por YouTube en la fecha indicada.\n4. El ganador será contactado por teléfono y email.',
    },
    {
      id: 2, title: 'Sorteo de Primavera', prize: 'Fiat Cronos 0km', description: '', imageUrl: null, chancesGoal: null, nextNumber: 100000,
      drawDate: iso(30 * DAY), youtubeUrl: null, permitNumber: 'DEMO-2026-000', status: 'drawn', winnerNumber: null, terms: '', createdAt: iso(60 * DAY),
    },
    {
      id: 3, title: 'Sorteo de Invierno', prize: 'Renault Kwid 0km', description: '', imageUrl: null, chancesGoal: null, nextNumber: 100000,
      drawDate: iso(120 * DAY), youtubeUrl: null, permitNumber: 'DEMO-2026-00A', status: 'drawn', winnerNumber: null, terms: '', createdAt: iso(150 * DAY),
    },
  ],
  chances: [], // { raffleId, number, orderId, status }
  orders: [],
  freeEntries: [],
};

class Err { constructor(status, body) { this.status = status; this.body = body; } }
const raffleOr404 = (id) => { const r = db.raffles.find((x) => String(x.id) === String(id)); if (!r) throw new Err(404, { error: 'Sorteo no encontrado' }); return r; };
const orderOr404 = (id) => { const o = db.orders.find((x) => x.id === id); if (!o) throw new Err(404, { error: 'Compra no encontrada' }); return o; };

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
  const chances = p.chances * (double ? 2 : 1);
  const totalCents = Math.round(p.price * 100) + extra;
  return { packId: p.id, chances, packPrice: p.price, double, doubleExtra: extra / 100, total: totalCents / 100, perChance: Math.round(totalCents / chances) / 100 };
};
const savingsPct = (per, base) => { const pct = Math.round((1 - per / base) * 100); return pct > 0 ? pct : null; };
const packPreview = ({ packs, offer }) => {
  const smallest = packs.reduce((a, p) => (!a || p.chances < a.chances ? p : a), null);
  const base = smallest ? packQuote(smallest, offer, false).perChance : null;
  return packs.map((p) => {
    const plain = packQuote(p, offer, false);
    const dbl = offer.enabled && p.doubleEligible ? packQuote(p, offer, true) : null;
    return {
      id: p.id, chances: p.chances, price: p.price, perChance: plain.perChance, savingsPct: savingsPct(plain.perChance, base),
      featured: p.featured, position: p.position, double: dbl && { ...dbl, savingsPct: savingsPct(dbl.perChance, base) },
    };
  });
};
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

function quoteFor(raffleId, b) {
  const r = raffleOr404(raffleId);
  assertOpen(r, 'El sorteo no está a la venta');
  const c = packConfig(r.id);
  const p = c.packs.find((x) => x.id === Number(b.packId));
  if (!p) throw new Err(400, { error: 'Pack inválido' });
  if (b.double === true && !(c.offer.enabled && p.doubleEligible)) throw new Err(400, { error: 'La oferta "Duplicá" no está disponible para este pack' });
  return packQuote(p, c.offer, b.double === true);
}


// ---- Números consecutivos (demo): mismo comportamiento que backend/src/services/numbers.js ----
function assignNumbers(o) {
  const r = raffleOr404(o.RaffleId);
  const first = r.nextNumber;
  r.nextNumber += o.chances;
  for (let n = first; n < r.nextNumber; n++) db.chances.push({ raffleId: r.id, number: n, orderId: o.id, status: 'valid' });
  Object.assign(o, { firstNumber: first, lastNumber: r.nextNumber - 1 });
}
const salesOpen = (r) => r.status === 'active' && (!r.salesCloseAt || now() < Date.parse(r.salesCloseAt));
const assertOpen = (r, msg) => {
  if (salesOpen(r)) return;
  throw new Err(409, { error: r.status === 'active' ? 'La venta de este sorteo ya cerró' : msg });
};
const chancesSold = (raffleId) => db.chances.filter((c) => c.raffleId === raffleId && c.status === 'valid' && c.orderId).length;
const pub = (r) => {
  const { createdAt, nextNumber, ...rest } = r;
  const prices = packConfig(r.id).packs.map((p) => p.price);
  return { ...rest, salesOpen: salesOpen(r), chancesSold: chancesSold(r.id), fromPrice: prices.length ? Math.min(...prices) : null };
};

// ---- Datos de ejemplo ----
const names = ['Ana Gómez', 'Carlos Ruiz', 'Lucía Fernández', 'Martín Sosa', 'Paula Díaz', 'Jorge Molina', 'Sofía Herrera', 'Diego Castro'];
let seed = 7;
const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return seed % n; };
function seedOrder(raffleId, i, { status = 'approved', minutesAgo = 60 } = {}) {
  const c = packConfig(raffleId);
  const p = c.packs[[0, 1, 2, 2, 1, 3, 2, 0, 4, 2, 1, 5][i % 12]]; // más ventas en los packs chicos y el destacado
  const double = c.offer.enabled && i % 4 === 1;
  const q = packQuote(p, c.offer, double);
  const course = db.courses[(i * 3 + 1) % 4];
  const o = {
    id: crypto.randomUUID(), RaffleId: raffleId, buyerName: names[i % names.length], buyerEmail: `cliente${i}@ejemplo.com`,
    buyerPhone: `2914${String(100000 + i * 7919).slice(0, 6)}`, buyerDni: String(25000000 + i * 123457),
    PackId: p.id, double, chances: q.chances, amount: q.total.toFixed(2), CourseId: course.id, courseTitle: course.title, status,
    firstNumber: null, lastNumber: null,
    mpPaymentId: status === 'approved' ? String(1300000000 + i) : null, mpStatusDetail: status === 'approved' ? 'accredited' : null,
    createdAt: iso(minutesAgo * 60000),
  };
  db.orders.push(o);
  if (status === 'approved' || status === 'manual') {
    assignNumbers(o);
    o.events = [{ id: 1, status: status === 'manual' ? 'manual' : 'approved', detail: status === 'manual' ? 'Venta cargada desde el panel' : 'Pago acreditado', mpPaymentId: o.mpPaymentId, createdAt: o.createdAt }];
    o.emailStatus = i % 23 === 5 ? 'failed' : 'sent';
    if (o.emailStatus === 'failed') o.emailLastError = 'Mailbox unavailable (550)';
  } else o.emailStatus = 'none';
  return o;
}
for (let i = 0; i < 70; i++) seedOrder(1, i, { status: i % 11 === 0 ? 'manual' : 'approved', minutesAgo: 60 * 24 * 5 - i * 90 });
seedOrder(1, 99, { status: 'pending', minutesAgo: 3 });
// Dos compras anuladas de ejemplo: un reintegro y un contracargo
const REVERSALS = { refunded: 'Pago reintegrado', charged_back: 'Contracargo: el comprador desconoce el pago' };
[[db.orders[3], 'refunded'], [db.orders[17], 'charged_back']].forEach(([o, status]) => {
  const at = new Date(Date.parse(o.createdAt) + 36 * 3600000).toISOString();
  db.chances.filter((c) => c.orderId === o.id).forEach((c) => Object.assign(c, { status: 'void', voidedAt: at, voidReason: REVERSALS[status] }));
  Object.assign(o, { status, voidedAt: at, voidReason: REVERSALS[status], mpStatusDetail: status });
  o.events.push({ id: 2, status, detail: REVERSALS[status], mpPaymentId: o.mpPaymentId, createdAt: at });
});
const ADMIN = 'admin@demo';
const auditLog = []; // más reciente primero
const draws = [];
let auditSeq = 1;
const logAudit = (action, raffleId, detail, at) => auditLog.unshift({ id: auditSeq++, actor: ADMIN, action, RaffleId: raffleId || null, detail: detail || null, ip: '127.0.0.1', createdAt: at || new Date(now()).toISOString() });
logAudit('login.ok', null, null, iso(5 * 3600000));
logAudit('raffle.update', 1, 'status=active', iso(4 * 3600000));
logAudit('packs.update', 1, '6 packs', iso(3 * 3600000));
[2, 3].forEach((id, k) => {
  for (let i = 0; i < 12; i++) seedOrder(id, i + k * 20, { minutesAgo: (40 + k * 90) * 24 * 60 });
  const r = db.raffles.find((x) => x.id === id);
  r.winnerNumber = 100000 + rnd(r.nextNumber - 100000);
});

function assertDrawable(r) {
  if (r.status === 'draft' || salesOpen(r)) throw new Err(409, { error: 'Cerrá la venta antes de cargar el ganador (podés poner una fecha de cierre o usar "Cerrar venta")' });
}
function redrawReason(r, reason) {
  if (r.status !== 'drawn') return null;
  const t = String(reason || '').trim();
  if (!t) throw new Err(409, { error: 'Ya hay un ganador. Para repetir el sorteo indicá el motivo.' });
  if (t.length < 10) throw new Err(400, { error: 'El motivo es muy corto: explicá por qué se repite el sorteo' });
  return t;
}
function finishDraw(r, c, { method, reason, validCount = null, position = null }) {
  draws.forEach((d) => { if (d.RaffleId === r.id && !d.supersededAt) d.supersededAt = new Date(now()).toISOString(); });
  draws.unshift({ id: draws.length + 1, RaffleId: r.id, number: c.number, method, validCount, position, actor: ADMIN, reason, supersededAt: null, createdAt: new Date(now()).toISOString() });
  Object.assign(r, { winnerNumber: c.number, status: 'drawn' });
  const kind = method === 'random' ? (reason ? 'draw.redo' : 'draw.run') : (reason ? 'winner.manual_redo' : 'winner.manual');
  logAudit(kind, r.id, `number=${c.number}${validCount ? `, valid=${validCount}, position=${position}` : ''}${reason ? `, reason=${reason}` : ''}`);
  if (c.freeEntryId) {
    const f = db.freeEntries.find((x) => x.id === c.freeEntryId);
    return { number: c.number, draw: draws[0], winner: { name: f.name, phone: null, email: f.email, dni: f.dni, orderId: null, source: 'free' } };
  }
  const o = orderOr404(c.orderId);
  return { number: c.number, draw: draws[0], winner: { name: o.buyerName, phone: o.buyerPhone, email: o.buyerEmail, dni: o.buyerDni, orderId: o.id, source: 'purchase' } };
}

const routes = [
  ['GET', /^\/raffles$/, () => db.raffles.filter((r) => r.status !== 'draft').sort((a, b) => b.drawDate.localeCompare(a.drawDate)).map(pub)],
  ['GET', /^\/raffles\/(\d+)$/, ([id]) => { const r = raffleOr404(id); if (r.status === 'draft') throw new Err(404, { error: 'Sorteo no encontrado' }); return pub(r); }],
  ['GET', /^\/raffles\/(\d+)\/packs$/, ([id]) => {
    const r = raffleOr404(id);
    if (r.status === 'draft') throw new Err(404, { error: 'Sorteo no encontrado' });
    const c = packConfig(r.id);
    return { offer: c.offer, packs: packPreview(c) };
  }],
  ['POST', /^\/raffles\/(\d+)\/quote$/, ([id], b) => quoteFor(id, b)],
  ['POST', /^\/raffles\/(\d+)\/purchases$/, ([id], b) => {
    const buyer = b.buyer || {};
    if (String(buyer.name || '').trim().length < 3) throw new Err(400, { error: 'Ingresá tu nombre y apellido' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(buyer.email || '').trim())) throw new Err(400, { error: 'El email no es válido' });
    if (String(buyer.phone || '').replace(/\D/g, '').length < 8) throw new Err(400, { error: 'El teléfono no es válido' });
    const dni = String(buyer.dni || '').replace(/\D/g, '');
    if (dni.length < 7 || dni.length > 8) throw new Err(400, { error: 'El DNI no es válido' });
    const course = db.courses.find((c) => c.id === Number(b.courseId) && c.active);
    if (!course) throw new Err(400, { error: 'Elegí un curso' });
    const q = quoteFor(id, b);
    const o = {
      id: crypto.randomUUID(), RaffleId: Number(id), buyerName: buyer.name.trim(), buyerEmail: buyer.email.trim().toLowerCase(), buyerPhone: buyer.phone, buyerDni: dni,
      PackId: q.packId, double: q.double, chances: q.chances, amount: q.total.toFixed(2), CourseId: course.id, courseTitle: course.title,
      status: 'pending', firstNumber: null, lastNumber: null, emailStatus: 'none', createdAt: iso(),
    };
    db.orders.unshift(o);
    return { orderId: o.id, checkoutUrl: `/demo-pago/${o.id}`, total: q.total, chances: q.chances };
  }],
  ['GET', /^\/orders\/([\w-]+)$/, ([id]) => {
    const o = orderOr404(id);
    const r = raffleOr404(o.RaffleId);
    return { ...o, Raffle: { id: r.id, title: r.title, prize: r.prize, drawDate: r.drawDate, youtubeUrl: r.youtubeUrl } };
  }],
  ['POST', /^\/orders\/([\w-]+)\/download-link$/, ([id]) => {
    const o = orderOr404(id);
    if (!['approved', 'manual'].includes(o.status)) throw new Err(409, { error: 'La compra todavía no está acreditada' });
    throw new Err(400, { error: 'En la demo no hay archivos reales para descargar. En la versión real se descarga el PDF.' });
  }],
  // "Mis compras": en la demo no se manda email, el link se abre desde la propia pantalla
  ['POST', /^\/my-purchases\/link$/, (_, b) => {
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Err(400, { error: 'Ingresá un email válido' });
    return { ok: true, demoToken: `demo:${email}` };
  }],
  ['GET', /^\/my-purchases$/, (_, __, ___, headers) => {
    const token = String(headers.Authorization || '').replace(/^Bearer /, '');
    if (!token.startsWith('demo:')) throw new Err(401, { error: 'El link venció o no es válido. Pedí uno nuevo.' });
    const email = token.slice(5);
    return db.orders
      .filter((o) => ['approved', 'manual'].includes(o.status) && String(o.buyerEmail).toLowerCase() === email)
      .map((o) => {
        const r = raffleOr404(o.RaffleId);
        return {
          id: o.id, createdAt: o.createdAt, courseTitle: o.courseTitle, hasCourse: true, chances: o.chances, double: o.double,
          firstNumber: o.firstNumber, lastNumber: o.lastNumber, amount: o.amount,
          raffle: { id: r.id, title: r.title, prize: r.prize, drawDate: r.drawDate, youtubeUrl: r.youtubeUrl },
        };
      });
  }],
  // Participación gratuita: en la demo no se manda email, el link se abre desde la propia pantalla
  ['POST', /^\/raffles\/(\d+)\/free-entries$/, ([id], b) => {
    const r = raffleOr404(id);
    if (r.status === 'draft') throw new Err(404, { error: 'Sorteo no encontrado' });
    if (!r.freeEntryEnabled) throw new Err(409, { error: 'Este sorteo no tiene participación gratuita' });
    assertOpen(r, 'La participación en este sorteo está cerrada');
    const dni = String(b.dni || '').replace(/\D/g, '');
    if (String(b.name || '').trim().length < 3) throw new Err(400, { error: 'Ingresá tu nombre completo' });
    if (dni.length < 7 || dni.length > 8) throw new Err(400, { error: 'El DNI no es válido' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email || '').trim())) throw new Err(400, { error: 'Ingresá un email válido' });
    const existing = db.freeEntries.find((f) => f.RaffleId === r.id && f.dni === dni);
    if (existing && existing.status !== 'unconfirmed') throw new Err(409, { error: 'Ese DNI ya está participando en este sorteo' });
    const token = `demo-${Math.random().toString(36).slice(2)}`;
    const fields = { name: String(b.name).trim(), dni, email: String(b.email).trim().toLowerCase(), token, status: 'unconfirmed' };
    if (existing) Object.assign(existing, fields);
    else db.freeEntries.unshift({ id: `fe-${db.freeEntries.length + 1}`, RaffleId: r.id, number: null, createdAt: iso(), ...fields });
    return { ok: true, demoToken: token };
  }],
  ['POST', /^\/free-entries\/confirm$/, (_, b) => {
    const f = db.freeEntries.find((x) => x.token === b.token);
    if (!f) throw new Err(404, { error: 'El link no es válido o ya fue reemplazado por uno más nuevo' });
    const r = raffleOr404(f.RaffleId);
    if (f.status === 'void') throw new Err(409, { error: 'Esta participación fue anulada' });
    const already = f.status === 'confirmed';
    if (!already) {
      f.number = r.nextNumber++;
      f.status = 'confirmed';
      db.chances.push({ raffleId: r.id, number: f.number, freeEntryId: f.id, status: 'valid' });
    }
    return { number: f.number, already, name: f.name, raffle: { id: r.id, title: r.title, prize: r.prize, drawDate: r.drawDate, youtubeUrl: r.youtubeUrl } };
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/search$/, ([id], _b, query) => {
    const r = raffleOr404(id);
    const q = String(query?.get('q') || '').trim();
    if (q.length < 3) throw new Err(400, { error: 'Escribí al menos 3 caracteres' });
    const digits = q.replace(/[.\s]/g, '');
    const lq = q.toLowerCase();
    const orderCard = (o) => ({
      kind: 'order', id: o.id, status: o.status, createdAt: o.createdAt, buyerName: o.buyerName, buyerDni: o.buyerDni, buyerEmail: o.buyerEmail,
      buyerPhone: o.buyerPhone, courseTitle: o.courseTitle, chances: o.chances, amount: o.amount, firstNumber: o.firstNumber, lastNumber: o.lastNumber,
      voidedNumbers: db.chances.filter((c) => c.orderId === o.id && c.status === 'void').length, mpPaymentId: o.mpPaymentId || null,
      mpStatusDetail: o.mpStatusDetail || null, voidedAt: o.voidedAt || null, voidReason: o.voidReason || null,
    });
    const freeCard = (f) => ({ kind: 'free', id: f.id, status: f.status, createdAt: f.createdAt, name: f.name, dni: f.dni, email: f.email, number: f.number, confirmedAt: f.confirmedAt });
    const orders = db.orders.filter((o) => o.RaffleId === r.id && o.status !== 'rejected');
    const frees = db.freeEntries.filter((f) => f.RaffleId === r.id && f.status !== 'unconfirmed');
    let type; let match = null; let oo = []; let ff = [];
    if (/^\d{6}$/.test(digits)) {
      type = 'number';
      const c = db.chances.find((x) => x.raffleId === r.id && x.number === Number(digits));
      if (c) {
        match = { number: c.number, status: c.status, voidedAt: c.voidedAt || null, voidReason: c.voidReason || null, source: c.orderId ? 'purchase' : 'free' };
        oo = orders.filter((o) => o.id === c.orderId);
        ff = frees.filter((f) => f.id === c.freeEntryId);
      }
    } else if (/^\d{7,8}$/.test(digits)) {
      type = 'dni';
      oo = orders.filter((o) => o.buyerDni === digits);
      ff = frees.filter((f) => f.dni === digits);
    } else {
      type = 'text';
      oo = orders.filter((o) => o.buyerEmail.toLowerCase().includes(lq) || o.buyerName.toLowerCase().includes(lq));
      ff = frees.filter((f) => f.email.toLowerCase().includes(lq) || f.name.toLowerCase().includes(lq));
    }
    return { type, query: q, match, results: [...oo.slice(0, 50).map(orderCard), ...ff.slice(0, 50).map(freeCard)], truncated: oo.length > 50 || ff.length > 50 };
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/free-entries$/, ([id]) => db.freeEntries.filter((f) => f.RaffleId === raffleOr404(id).id)
    .map(({ token, ...f }) => f)],
  ['POST', /^\/admin\/free-entries\/([\w-]+)\/void$/, ([id]) => {
    const f = db.freeEntries.find((x) => x.id === id);
    if (!f) throw new Err(404, { error: 'Participación no encontrada' });
    logAudit('free_entry.void', f.RaffleId, `entry=${f.id}`);
    db.chances.filter((c) => c.freeEntryId === f.id).forEach((c) => { c.status = 'void'; });
    f.status = 'void';
    return { id: f.id, status: f.status };
  }],
  ['POST', /^\/admin\/orders\/([\w-]+)\/resend-email$/, ([id], b) => {
    const o = orderOr404(id);
    if (!['approved', 'manual'].includes(o.status)) throw new Err(409, { error: 'Solo se reenvía el email de compras acreditadas' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email || ''))) throw new Err(400, { error: 'El email no es válido' });
    Object.assign(o, { buyerEmail: b.email.trim().toLowerCase(), emailStatus: 'sent', emailLastError: null });
    return { result: 'sent', emailStatus: 'sent', buyerEmail: o.buyerEmail };
  }],
  // Simula el aviso de Mercado Pago (en la app real llega por webhook)
  ['POST', /^\/demo\/pay\/([\w-]+)$/, ([id], body) => {
    const o = orderOr404(id);
    if (o.status !== 'pending') return o;
    if (body.result === 'approved') {
      assignNumbers(o);
      Object.assign(o, { status: 'approved', mpPaymentId: 'DEMO-' + Math.floor(Math.random() * 1e9), mpStatusDetail: 'accredited', emailStatus: 'sent' });
    } else {
      o.mpStatusDetail = 'cc_rejected_insufficient_amount'; // queda pendiente: puede reintentar
    }
    return o;
  }],
  ['POST', /^\/admin\/login$/, (_, b) => {
    if (b.email === 'demo@demo.com' && b.password === 'demo') return { token: 'demo-token' };
    throw new Err(401, { error: 'Credenciales inválidas (usá demo@demo.com / demo)' });
  }],
  ['GET', /^\/admin\/mp-status$/, () => ({ status: 'ok', reason: null, checkedAt: new Date(now() - 2 * 60 * 1000).toISOString(), since: null, consecutiveFailures: 0 })],
  ['POST', /^\/admin\/mp-status\/check$/, () => ({ status: 'ok', reason: null, checkedAt: new Date(now()).toISOString(), since: null, consecutiveFailures: 0 })],
  ['GET', /^\/admin\/raffles$/, () => [...db.raffles].sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
  ['POST', /^\/admin\/raffles$/, (_, b) => {
    if (!String(b.title || '').trim() || !String(b.prize || '').trim()) throw new Err(400, { error: 'El título y el premio son obligatorios' });
    const r = { ...b, id: nextRaffleId++, chancesGoal: b.chancesGoal || null, nextNumber: 100000, status: 'draft', winnerNumber: null, createdAt: iso() };
    db.raffles.push(r);
    packConfig(r.id);
    return r;
  }],
  ['PATCH', /^\/admin\/raffles\/(\d+)$/, ([id], b) => {
    if (b.status && !['draft', 'active', 'closed'].includes(b.status)) throw new Err(400, { error: 'Estado inválido' });
    if (b.status && raffleOr404(id).status === 'drawn') throw new Err(409, { error: 'El sorteo ya se realizó: no se puede cambiar el estado de la venta' });
    if (b.salesCloseAt && Number.isNaN(Date.parse(b.salesCloseAt))) throw new Err(400, { error: 'La fecha de cierre no es válida' });
    const changed = Object.keys(b).filter((k) => ['status', 'salesCloseAt', 'freeEntryEnabled', 'drawDate', 'chancesGoal'].includes(k)).map((k) => `${k}=${b[k]}`).join(', ');
    logAudit('raffle.update', Number(id), changed || Object.keys(b).join(', '));
    return Object.assign(raffleOr404(id), b, 'salesCloseAt' in b ? { salesCloseAt: b.salesCloseAt || null } : {});
  }],
  ['POST', /^\/admin\/raffles\/(\d+)\/readiness$/, ([id]) => {
    const r = raffleOr404(id);
    const os = db.orders.filter((o) => o.RaffleId === r.id);
    logAudit('readiness.check', r.id);
    const valid = db.chances.filter((c) => c.raffleId === r.id && c.status === 'valid');
    const paid = valid.filter((c) => c.orderId).length;
    const review = os.filter((o) => o.status === 'needs_review').length;
    const noPayment = os.filter((o) => o.status === 'pending').length;
    const closed = !salesOpen(r) && r.status !== 'draft';
    const blockers = [];
    if (!closed) blockers.push('La venta sigue abierta');
    if (review) blockers.push(`${review} compra(s) para revisar (monto distinto)`);
    return {
      checkedAt: new Date(now()).toISOString(), salesClosed: closed, salesCloseAt: r.salesCloseAt || null, checked: noPayment, recovered: 0,
      awaiting: 0, noPayment, errors: 0, notChecked: 0, needsReview: review, abandoned: 0,
      unconfirmedFree: db.freeEntries.filter((f) => f.RaffleId === r.id && f.status === 'unconfirmed').length,
      validChances: valid.length, paidChances: paid, freeChances: valid.length - paid, ready: !blockers.length, blockers,
    };
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/packs$/, ([id]) => adminPacks(packConfig(raffleOr404(id).id))],
  ['PUT', /^\/admin\/raffles\/(\d+)\/packs$/, ([id], b) => savePacks(raffleOr404(id).id, b)],
  ['POST', /^\/admin\/raffles\/(\d+)\/winner$/, ([id], b) => {
    const r = raffleOr404(id);
    assertDrawable(r);
    const why = redrawReason(r, b.reason);
    const c = db.chances.find((x) => x.raffleId === r.id && x.number === Number(b.number));
    if (!c) throw new Err(400, { error: 'Ese número no fue asignado en este sorteo' });
    if (c.status === 'void') throw new Err(409, { error: 'Ese número está anulado (compra reintegrada): sorteá de nuevo' });
    return finishDraw(r, c, { method: 'manual', reason: why });
  }],
  ['POST', /^\/admin\/raffles\/(\d+)\/draw$/, ([id], b) => {
    const r = raffleOr404(id);
    assertDrawable(r);
    const why = redrawReason(r, b.reason);
    const valid = db.chances.filter((x) => x.raffleId === r.id && x.status === 'valid').sort((x, y) => x.number - y.number);
    if (!valid.length) throw new Err(409, { error: 'No hay números válidos para sortear' });
    const position = crypto.getRandomValues(new Uint32Array(1))[0] % valid.length;
    return finishDraw(r, valid[position], { method: 'random', reason: why, validCount: valid.length, position });
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/draws$/, ([id]) => draws.filter((d) => d.RaffleId === Number(id))],
  ['GET', /^\/admin\/audit$/, (_, __, q) => {
    const rid = q.get('raffleId');
    return auditLog.filter((l) => !rid || l.RaffleId === Number(rid)).slice(0, Math.min(Number(q.get('limit')) || 50, 200));
  }],
  ['GET', /^\/admin\/raffles\/(\d+)\/stats$/, ([id]) => {
    const r = raffleOr404(id);
    const os = db.orders.filter((o) => o.RaffleId === r.id);
    const sold = os.filter((o) => ['approved', 'manual'].includes(o.status));
    return {
      chancesSold: chancesSold(r.id), purchases: sold.length, pending: os.filter((o) => o.status === 'pending').length,
      review: os.filter((o) => o.status === 'needs_review').length, revenue: sold.reduce((a, o) => a + Number(o.amount), 0),
      freeEntries: db.freeEntries.filter((f) => f.RaffleId === r.id && f.status === 'confirmed').length,
      reversed: os.filter((o) => ['refunded', 'charged_back'].includes(o.status)).length,
      winnerVoided: false,
    };
  }],
  ['GET', /^\/admin\/orders\/([\w-]+)\/history$/, ([id]) => {
    const o = orderOr404(id);
    return { status: o.status, voidedAt: o.voidedAt || null, voidReason: o.voidReason || null, voidedNumbers: db.chances.filter((c) => c.orderId === o.id && c.status === 'void').length, events: o.events || [] };
  }],
  ['GET', /^\/admin\/orders$/, (_, __, q) => db.orders
    .filter((o) => (!q.get('raffleId') || String(o.RaffleId) === q.get('raffleId')) && (!q.get('status') || o.status === q.get('status')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
  ['POST', /^\/admin\/orders\/manual$/, (_, b) => {
    const r = raffleOr404(b.raffleId);
    logAudit('order.manual', r.id, `chances=${b.chances}, amount=${b.amount}`);
    if (r.status === 'drawn') throw new Err(409, { error: 'El sorteo ya se realizó' });
    if (!Number.isInteger(b.chances) || b.chances < 1) throw new Err(400, { error: 'Cantidad de chances inválida' });
    const course = db.courses.find((c) => c.id === Number(b.courseId));
    if (!course) throw new Err(400, { error: 'Elegí el curso' });
    const dni = String(b.buyer?.dni || '').replace(/\D/g, '');
    if (String(b.buyer?.name || '').trim().length < 3) throw new Err(400, { error: 'Falta el nombre del comprador' });
    if (dni.length < 7 || dni.length > 8) throw new Err(400, { error: 'El DNI no es válido' });
    const o = {
      id: crypto.randomUUID(), RaffleId: r.id, buyerName: b.buyer.name.trim(), buyerEmail: b.buyer.email || '-', buyerPhone: b.buyer.phone || '-', buyerDni: dni,
      chances: b.chances, double: false, amount: Number(b.amount || 0).toFixed(2), CourseId: course.id, courseTitle: course.title, status: 'manual', createdAt: iso(),
      emailStatus: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.buyer.email || '') ? 'sent' : 'none',
    };
    assignNumbers(o);
    db.orders.unshift(o);
    return o;
  }],
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
    const rows = db.orders.filter((o) => String(o.RaffleId) === id && ['approved', 'manual', 'needs_review', 'refunded', 'charged_back'].includes(o.status));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return { __csv: ['Fecha;Nombre;DNI;Teléfono;Email;Curso;Chances;Desde;Hasta;Monto;Estado;Pago MP',
      ...rows.map((o) => [o.createdAt, o.buyerName, o.buyerDni, o.buyerPhone, o.buyerEmail, o.courseTitle, o.chances, o.firstNumber, o.lastNumber, o.amount, o.status, o.mpPaymentId].map(esc).join(';'))].join('\n') };
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
    await new Promise((r) => setTimeout(r, 150)); // latencia simulada
    for (const [m, re, fn] of routes) {
      const match = method === m && path.match(re);
      if (!match) continue;
      try {
        const data = fn(match.slice(1), body, url.searchParams, init.headers || {});
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
