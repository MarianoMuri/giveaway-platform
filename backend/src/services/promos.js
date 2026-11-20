const { Op, fn, col } = require('sequelize');
const { Promo, Order } = require('../db');
const { HttpError } = require('./errors');

/**
 * Promos de un sorteo: "descuento" (% menos en el total), "chances de regalo" (chances de más) o las dos juntas.
 * Cada parte se activa por separado; la promo tiene que dar al menos una.
 *
 * - Con código: el comprador lo escribe. Sin código: es automática y se aplica sola a todos.
 * - El administrador las enciende y apaga con un interruptor; las fechas y el tope de usos son opcionales.
 * - Una compra usa UNA sola promo. Si el comprador escribe un código, se usa ese en lugar de la automática.
 *   Entre varias automáticas, se aplica la que más le conviene al comprador.
 * - Todo se calcula acá, en centavos enteros. El frontend nunca calcula precios.
 */

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
  if (!Number.isInteger(percent) || percent < 0 || percent > MAX_PERCENT) throw new HttpError(400, `El descuento tiene que ser un número entero de 1 a ${MAX_PERCENT} (o 0 si la promo no lleva descuento)`);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > MAX_BONUS) throw new HttpError(400, `Las chances de regalo tienen que ser un número entero de 1 a ${MAX_BONUS} (o 0 si la promo no regala chances)`);
  if (percent === 0 && bonus === 0) throw new HttpError(400, 'Activá al menos una cosa: descuento o chances de regalo');

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

  return { name, percent, bonus, minChances: minRaw, code: code || null, enabled: Boolean(b.enabled), startsAt, endsAt, maxUses };
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
const meetsMin = (promo, chances) => chances >= (promo.minChances || 0);

// Cuánto le conviene al comprador, en centavos (sirve para elegir entre promos automáticas):
// lo que se ahorra más el valor de las chances de regalo, a lo que sale cada chance
function benefitCents(promo, q) {
  const total = toCents(q.total);
  const discount = Math.round((total * promo.percent) / 100);
  const perChance = Math.round((total - discount) / (q.chances + promo.bonus));
  return discount + promo.bonus * perChance;
}

// Aplica una promo a una cotización ya calculada (pack + "Duplicá"). Si la promo trae las dos cosas,
// el descuento baja el total y las chances de regalo se suman a la compra.
function apply(q, promo) {
  const total = toCents(q.total);
  const discount = Math.round((total * promo.percent) / 100);
  const bonus = promo.bonus;
  const chances = q.chances + bonus;
  const finalCents = total - discount;
  return {
    ...q,
    chances,
    total: fromCents(finalCents),
    perChance: fromCents(Math.round(finalCents / chances)),
    discount: fromCents(discount),
    bonusChances: bonus,
    promo: { id: promo.id, name: promo.name, percent: promo.percent, bonus: promo.bonus, code: promo.code || null },
  };
}

// La mejor promo automática vigente para esta cotización (o null)
function bestAutomatic(promos, q, now = new Date()) {
  let best = null;
  let bestValue = 0;
  for (const p of promos) {
    if (p.code || !isLive(p, now) || !meetsMin(p, q.chances)) continue;
    const v = benefitCents(p, q);
    if (v > bestValue || (v === bestValue && best && p.id < best.id)) {
      best = p;
      bestValue = v;
    }
  }
  return best;
}

// Elige la promo de una compra: el código si lo hay, si no la mejor automática.
// Un código inválido NO se ignora en silencio: el comprador tiene que enterarse antes de pagar.
function select({ promos, q, code, now = new Date() }) {
  const wanted = normalizeCode(code);
  if (wanted) {
    const p = promos.find((x) => x.code === wanted);
    if (!p || stateOf(p, now) === 'off' || stateOf(p, now) === 'scheduled' || stateOf(p, now) === 'expired') {
      throw new HttpError(400, 'El código no es válido o ya venció');
    }
    if (stateOf(p, now) === 'soldout') throw new HttpError(400, 'Este código ya no tiene usos disponibles');
    if (!meetsMin(p, q.chances)) throw new HttpError(400, `Este código aplica a compras de ${p.minChances} chances o más`);
    return p;
  }
  return bestAutomatic(promos, q, now);
}

// Cotización final de una compra: base + promo elegida
function priceWithPromo({ promos, q, code, now }) {
  const p = select({ promos, q, code, now });
  return p ? apply(q, p) : q;
}

// ---- Acceso a la base ----

// Promos de un sorteo, cada una con la cantidad de compras acreditadas que la usaron
async function listForRaffle(raffleId) {
  const rows = await Promo.findAll({ where: { RaffleId: raffleId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  if (!rows.length) return [];
  const counts = await Order.findAll({
    where: { PromoId: rows.map((r) => r.id), status: { [Op.in]: ['approved', 'manual'] } },
    attributes: ['PromoId', [fn('COUNT', col('id')), 'n']],
    group: ['PromoId'],
    raw: true,
  });
  const usedBy = new Map(counts.map((c) => [c.PromoId, Number(c.n)]));
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
  MAX_PERCENT, normalizeCode, validate, stateOf, benefitCents, apply, bestAutomatic, select, priceWithPromo,
  listForRaffle, create, update, remove,
};
