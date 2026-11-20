const { Op } = require('sequelize');
const { Promo, Order } = require('../db');
const { HttpError } = require('./errors');

/**
 * Promos de un sorteo. Cada promo da UNA cosa:
 *  - "descuento": un % menos en el total, o
 *  - "chances de regalo": N chances de más por cada X chances compradas (comprar 3 no es lo mismo que comprar 50).
 *
 * - Con código: el comprador lo escribe. Sin código: es automática y se aplica sola a todos.
 * - El administrador las enciende y apaga con un interruptor; cada una tiene sus propias fechas, mínimo y tope de usos.
 * - Pueden estar varias a la vez. Si coinciden dos descuentos (o dos regalos) el sorteo elige: aplicar la mayor
 *   ('best') o sumarlas ('sum'). Un descuento y un regalo siempre van juntos.
 * - Todo se calcula acá, en centavos enteros. El frontend nunca calcula precios.
 */

// Cupos firmes: quien empieza a comprar con una promo con tope reserva su lugar mientras paga. Si no paga en este
// tiempo, el lugar se libera (y el link de pago vence, ver mercadopago.js).
const RESERVE_MINUTES = 5;
const MAX_PERCENT = 90; // un 100% dejaría el pago en 0 y Mercado Pago no lo acepta
const MAX_BONUS = 1000;
const MAX_PROMOS = 30;
const CODE = /^[A-Z0-9_-]{3,30}$/;

const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => c / 100;

// El código se compara sin importar mayúsculas ni espacios: "zona 10" y "ZONA10" son lo mismo
const normalizeCode = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();

function toDate(v, label) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `La fecha de ${label} no es válida`);
  return d;
}

// Valida lo que manda el panel. Devuelve solo los campos que se guardan.
function validate(input) {
  const b = input || {};
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Poné un nombre para la promo (hasta 80 letras)');

  const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
  const percent = num(b.percent);
  const bonus = num(b.bonus);
  if (!Number.isInteger(percent) || percent < 0 || percent > MAX_PERCENT) throw new HttpError(400, `El descuento tiene que ser un número entero de 1 a ${MAX_PERCENT}`);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > MAX_BONUS) throw new HttpError(400, `Las chances de regalo tienen que ser un número entero de 1 a ${MAX_BONUS}`);
  if ((percent > 0) === (bonus > 0)) throw new HttpError(400, 'Cada promo da una sola cosa: un descuento o chances de regalo. Para dar las dos, creá dos promos');
  let bonusEvery = 1;
  if (bonus > 0) {
    bonusEvery = num(b.bonusEvery) || 1;
    if (!Number.isInteger(bonusEvery) || bonusEvery < 1 || bonusEvery > 10000) throw new HttpError(400, 'El "por cada" tiene que ser un número entero mayor a 0 (ej: 1 de regalo por cada 10 chances)');
  }

  const minRaw = b.minChances === undefined || b.minChances === null || b.minChances === '' ? 0 : Number(b.minChances);
  if (!Number.isInteger(minRaw) || minRaw < 0 || minRaw > 10000) throw new HttpError(400, 'El mínimo de chances tiene que ser un número entero (0 si no hay mínimo)');

  const code = normalizeCode(b.code);
  if (code && !CODE.test(code)) throw new HttpError(400, 'El código puede tener letras, números, guion y guion bajo (de 3 a 30 caracteres)');

  const startsAt = toDate(b.startsAt, 'inicio');
  const endsAt = toDate(b.endsAt, 'fin');
  if (startsAt && endsAt && endsAt <= startsAt) throw new HttpError(400, 'La fecha de fin tiene que ser posterior a la de inicio');

  let maxUses = null;
  if (b.maxUses !== undefined && b.maxUses !== null && b.maxUses !== '') {
    maxUses = Number(b.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new HttpError(400, 'El tope de usos tiene que ser un número entero mayor a 0 (o dejalo vacío)');
  }

  return { name, percent, bonus, bonusEvery, minChances: minRaw, code: code || null, enabled: Boolean(b.enabled), startsAt, endsAt, maxUses };
}

// Estado que ve el administrador
function stateOf(promo, now = new Date()) {
  if (!promo.enabled) return 'off';
  if (promo.startsAt && new Date(promo.startsAt) > now) return 'scheduled';
  if (promo.endsAt && new Date(promo.endsAt) <= now) return 'expired';
  if (promo.maxUses && (promo.used || 0) >= promo.maxUses) return 'soldout';
  return 'on';
}

const isLive = (promo, now) => stateOf(promo, now) === 'on';

// Mínimo real de chances: el que puso el administrador, y en las de regalo al menos el "por cada"
const minOf = (promo) => Math.max(promo.minChances || 0, promo.bonus > 0 ? promo.bonusEvery || 1 : 0);
const meetsMin = (promo, chances) => chances >= minOf(promo);

// Chances de regalo de una promo para una compra de `chances`: N por cada bloque completo de X
const giftFor = (promo, chances) => (promo.bonus > 0 ? Math.floor(chances / (promo.bonusEvery || 1)) * promo.bonus : 0);

const brief = (p) => ({ id: p.id, name: p.name, percent: p.percent, bonus: p.bonus, bonusEvery: p.bonusEvery || 1, code: p.code || null, maxUses: p.maxUses || null });

// Promos que valen para esta compra: las automáticas vigentes, más la del código si el comprador escribió uno.
// Un código inválido NO se ignora en silencio: el comprador tiene que enterarse antes de pagar.
function candidates({ promos, q, code, now = new Date() }) {
  const pool = promos.filter((p) => !p.code && isLive(p, now) && meetsMin(p, q.chances));
  const wanted = normalizeCode(code);
  if (wanted) {
    const p = promos.find((x) => x.code === wanted);
    const st = p && stateOf(p, now);
    if (!p || st === 'off' || st === 'scheduled' || st === 'expired') throw new HttpError(400, 'El código no es válido o ya venció');
    if (st === 'soldout') throw new HttpError(400, 'Este código ya no tiene usos disponibles');
    if (!meetsMin(p, q.chances)) throw new HttpError(400, `Este código aplica a compras de ${minOf(p)} chances o más`);
    pool.push(p);
  }
  return pool;
}

// De los candidatos, cuáles se aplican de verdad. 'best': el mayor descuento y el mayor regalo. 'sum': todos.
function choose(pool, chances, mode = 'best') {
  const byId = (a, b) => a.id - b.id;
  const discounts = pool.filter((p) => p.percent > 0).sort(byId);
  const gifts = pool.filter((p) => p.bonus > 0).sort(byId);
  const top = (list, value) => list.reduce((best, p) => (!best || value(p) > value(best) ? p : best), null);
  if (mode === 'sum') return [...discounts, ...gifts];
  const d = top(discounts, (p) => p.percent);
  const g = top(gifts, (p) => giftFor(p, chances));
  return [d, g].filter(Boolean);
}

// Aplica las promos elegidas a una cotización ya calculada (pack + "Duplicá"): el descuento baja el total
// y las chances de regalo se suman a la compra.
function apply(q, applied) {
  if (!applied.length) return q;
  const total = toCents(q.total);
  const percent = Math.min(MAX_PERCENT, applied.reduce((n, p) => n + p.percent, 0));
  const discount = Math.round((total * percent) / 100);
  const bonus = applied.reduce((n, p) => n + giftFor(p, q.chances), 0);
  const chances = q.chances + bonus;
  const finalCents = total - discount;
  return {
    ...q,
    chances,
    total: fromCents(finalCents),
    perChance: fromCents(Math.round(finalCents / chances)),
    discount: fromCents(discount),
    bonusChances: bonus,
    applied: applied.map(brief),
    promo: { id: applied[0].id, name: applied.map((p) => p.name).join(' + '), code: applied.find((p) => p.code)?.code || null },
  };
}

// Cotización final de una compra: base + promos
function priceWithPromo({ promos, q, code, mode, now }) {
  return apply(q, choose(candidates({ promos, q, code, now }), q.chances, mode));
}

// Solo las automáticas (lo que se muestra en la página, sin código)
function priceAutomatic({ promos, q, mode, now }) {
  return apply(q, choose(candidates({ promos, q, now }), q.chances, mode));
}

// ---- Acceso a la base ----

// Cuántas compras ocupan lugar en cada promo: las acreditadas y las que están pagando ahora mismo
// (una compra pendiente reserva su cupo RESERVE_MINUTES). Devuelve Map(promoId -> cantidad).
async function usedByPromo(raffleId, { transaction } = {}) {
  const since = new Date(Date.now() - RESERVE_MINUTES * 60 * 1000);
  const orders = await Order.findAll({
    where: {
      RaffleId: raffleId,
      PromoIds: { [Op.ne]: null },
      [Op.or]: [{ status: { [Op.in]: ['approved', 'manual', 'in_process'] } }, { status: 'pending', createdAt: { [Op.gt]: since } }],
    },
    attributes: ['PromoIds'],
    raw: true,
    transaction,
  });
  const usedBy = new Map();
  for (const o of orders) for (const id of String(o.PromoIds).split(',')) usedBy.set(Number(id), (usedBy.get(Number(id)) || 0) + 1);
  return usedBy;
}

// Promos de un sorteo, cada una con la cantidad de compras que ocupan un cupo
async function listForRaffle(raffleId) {
  const rows = await Promo.findAll({ where: { RaffleId: raffleId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  if (!rows.length) return [];
  const usedBy = await usedByPromo(raffleId);
  return rows.map((r) => {
    const p = { ...r.toJSON(), used: usedBy.get(r.id) || 0 };
    return { ...p, state: stateOf(p) };
  });
}

async function create(raffleId, input) {
  const data = validate(input);
  if ((await Promo.count({ where: { RaffleId: raffleId } })) >= MAX_PROMOS) throw new HttpError(400, `Máximo ${MAX_PROMOS} promos por sorteo`);
  await assertCodeFree(raffleId, data.code);
  const row = await Promo.create({ ...data, RaffleId: raffleId });
  return (await listForRaffle(raffleId)).find((p) => p.id === row.id);
}

async function update(raffleId, promoId, input) {
  const row = await Promo.findOne({ where: { id: Number(promoId) || 0, RaffleId: raffleId } });
  if (!row) throw new HttpError(404, 'Promo inexistente');
  const data = validate({ ...row.toJSON(), ...(input || {}) });
  await assertCodeFree(raffleId, data.code, row.id);
  await row.update(data);
  return (await listForRaffle(raffleId)).find((p) => p.id === row.id);
}

async function remove(raffleId, promoId) {
  const row = await Promo.findOne({ where: { id: Number(promoId) || 0, RaffleId: raffleId } });
  if (!row) throw new HttpError(404, 'Promo inexistente');
  await row.destroy(); // las compras ya hechas conservan su copia (nombre, código y descuento)
}

async function assertCodeFree(raffleId, code, exceptId = null) {
  if (!code) return;
  const where = { RaffleId: raffleId, code, ...(exceptId && { id: { [Op.ne]: exceptId } }) };
  if (await Promo.count({ where })) throw new HttpError(409, 'Ya hay otra promo con ese código en este sorteo');
}

module.exports = {
  MAX_PERCENT, RESERVE_MINUTES, usedByPromo, normalizeCode, validate, stateOf, giftFor, candidates, choose, apply, priceWithPromo, priceAutomatic,
  listForRaffle, create, update, remove,
};
