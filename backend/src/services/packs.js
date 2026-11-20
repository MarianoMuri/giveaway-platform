const { sequelize, Raffle, Pack } = require('../db');
const { HttpError } = require('./errors');
const sales = require('./sales');
const promos = require('./promos');

// Escalera sugerida para un sorteo nuevo (el admin la cambia desde el panel)
const DEFAULT_PACKS = [
  { chances: 5, price: 15000 },
  { chances: 10, price: 25000 },
  { chances: 20, price: 45000, featured: true },
  { chances: 30, price: 60000 },
  { chances: 50, price: 90000 },
  { chances: 100, price: 130000 },
];
const DEFAULT_OFFER = { enabled: true, pricePerChance: 1000 };

const MAX_PACKS = 12;
const MAX_CHANCES = 10000;

// Los montos se calculan en centavos enteros: 0.1 + 0.2 !== 0.3 en coma flotante
const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => c / 100;

/**
 * Cotización de un pack. Es la única fuente de verdad del total:
 * el frontend muestra lo que devuelve esto y el pago se crea con este monto.
 */
function quote({ pack, offer, double = false }) {
  const packCents = toCents(pack.price);
  let extraChances = 0;
  let extraCents = 0;
  if (double) {
    if (!offer.enabled || !pack.doubleEligible) throw new HttpError(400, 'La oferta "Duplicá" no está disponible para este pack');
    extraChances = pack.chances;
    extraCents = extraChances * toCents(offer.pricePerChance);
  }
  const chances = pack.chances + extraChances;
  return {
    packId: pack.id,
    chances,
    packPrice: fromCents(packCents),
    double: Boolean(double),
    doubleExtra: fromCents(extraCents),
    total: fromCents(packCents + extraCents),
    perChance: fromCents(Math.round((packCents + extraCents) / chances)),
  };
}

function offerOf(raffle) {
  return { enabled: Boolean(raffle.doubleEnabled), pricePerChance: Number(raffle.doublePricePerChance) || 0 };
}

// Valida la configuración completa que manda el panel: { packs: [...], offer: {...} }
function validateConfig(input) {
  if (!input || !Array.isArray(input.packs)) throw new HttpError(400, 'Falta la lista de packs');
  if (input.packs.length === 0) throw new HttpError(400, 'Tiene que haber al menos un pack');
  if (input.packs.length > MAX_PACKS) throw new HttpError(400, `Máximo ${MAX_PACKS} packs`);

  const seen = new Set();
  const packs = input.packs.map((p, i) => {
    const chances = Number(p.chances);
    const price = Number(p.price);
    if (!Number.isInteger(chances) || chances < 1 || chances > MAX_CHANCES) {
      throw new HttpError(400, `Pack ${i + 1}: la cantidad de chances debe ser un entero entre 1 y ${MAX_CHANCES}`);
    }
    if (!(price > 0)) throw new HttpError(400, `Pack ${i + 1}: el precio debe ser mayor a 0`);
    if (seen.has(chances)) throw new HttpError(400, `Hay dos packs de ${chances} chances`);
    seen.add(chances);
    return {
      id: p.id ? Number(p.id) : undefined,
      chances,
      price: fromCents(toCents(price)),
      position: Number.isInteger(Number(p.position)) ? Number(p.position) : i,
      featured: Boolean(p.featured),
      doubleEligible: p.doubleEligible === undefined ? true : Boolean(p.doubleEligible),
    };
  });
  if (packs.filter((p) => p.featured).length > 1) throw new HttpError(400, 'Solo un pack puede ser "El más elegido"');

  const o = input.offer || {};
  const offer = { enabled: Boolean(o.enabled), pricePerChance: Number(o.pricePerChance) || 0 };
  if (offer.enabled && !(offer.pricePerChance > 0)) throw new HttpError(400, 'Indicá el precio por chance extra de "Duplicá"');
  if (offer.enabled && !packs.some((p) => p.doubleEligible)) throw new HttpError(400, '"Duplicá" está activa pero no aparece en ningún pack');
  return { packs, offer };
}

async function getConfig(raffleId) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo no encontrado');
  const packs = await Pack.findAll({ where: { RaffleId: raffle.id }, order: [['position', 'ASC'], ['chances', 'ASC']] });
  return { raffle, packs, offer: offerOf(raffle), promos: await promos.listForRaffle(raffle.id) };
}

// Guarda packs + oferta en una transacción. Los packs existentes se actualizan
// (mantienen su id, que van a referenciar las compras), los nuevos se crean y
// los que ya no vienen en la lista se borran.
async function saveConfig(raffleId, input) {
  const { packs, offer } = validateConfig(input);
  return sequelize.transaction(async (transaction) => {
    const raffle = await Raffle.findByPk(raffleId, { transaction });
    if (!raffle) throw new HttpError(404, 'Sorteo no encontrado');
    const current = await Pack.findAll({ where: { RaffleId: raffle.id }, transaction });
    const byId = new Map(current.map((p) => [p.id, p]));

    for (const p of packs) {
      if (p.id && !byId.has(p.id)) throw new HttpError(400, `El pack ${p.id} no pertenece a este sorteo`);
    }
    const keep = new Set(packs.filter((p) => p.id).map((p) => p.id));
    // Primero se borran los que salen, para que un cambio de cantidades no choque
    for (const p of current) if (!keep.has(p.id)) await p.destroy({ transaction });
    for (const { id, ...data } of packs) {
      if (id) await byId.get(id).update(data, { transaction });
      else await Pack.create({ ...data, RaffleId: raffle.id }, { transaction });
    }
    await raffle.update({ doubleEnabled: offer.enabled, doublePricePerChance: offer.pricePerChance }, { transaction });
  }).then(() => getConfig(raffleId));
}

async function seedDefaults(raffle, transaction) {
  await Pack.bulkCreate(DEFAULT_PACKS.map((p, i) => ({ ...p, position: i, RaffleId: raffle.id })), { transaction });
  await raffle.update({ doubleEnabled: DEFAULT_OFFER.enabled, doublePricePerChance: DEFAULT_OFFER.pricePerChance }, { transaction });
}

// Ahorro real: se compara el precio por chance contra el del pack más chico.
// Nada de precios "antes" inventados: si no hay ahorro, no se muestra.
function savingsPct(perChance, basePerChance) {
  if (!basePerChance) return null;
  const pct = Math.round((1 - perChance / basePerChance) * 100);
  return pct > 0 ? pct : null;
}

// Vista pública: cada pack ya trae calculado su precio por chance, el ahorro y cómo queda con "Duplicá".
// Si hay una promo automática vigente, cada pack (y su versión "Duplicá") trae además `final`: lo que se
// paga de verdad con la promo. Las promos con código nunca se listan: solo las conoce quien las recibe.
function publicView({ packs, offer, promos: allPromos = [], raffle }) {
  const smallest = packs.reduce((a, p) => (!a || p.chances < a.chances ? p : a), null);
  const base = smallest ? quote({ pack: smallest, offer }).perChance : null;
  const now = new Date();
  const mode = raffle?.promoMode || 'best';
  const withFinal = (q) => {
    const f = promos.priceAutomatic({ promos: allPromos, q, mode, now });
    if (!f.applied) return null;
    return { chances: f.chances, total: f.total, perChance: f.perChance, discount: f.discount, bonusChances: f.bonusChances, promo: { name: f.promo.name }, applied: f.applied };
  };
  const automatic = allPromos
    .filter((p) => !p.code && promos.stateOf(p, now) === 'on')
    .map((p) => ({ name: p.name, percent: p.percent, bonus: p.bonus, bonusEvery: p.bonusEvery, minChances: p.minChances, endsAt: p.endsAt, left: p.maxUses ? Math.max(0, p.maxUses - (p.used || 0)) : null }));
  return {
    offer,
    promos: automatic,
    packs: packs.map((p) => {
      const plain = quote({ pack: p, offer });
      const double = offer.enabled && p.doubleEligible ? quote({ pack: p, offer, double: true }) : null;
      return {
        id: p.id,
        chances: p.chances,
        price: Number(p.price),
        perChance: plain.perChance,
        savingsPct: savingsPct(plain.perChance, base),
        featured: p.featured,
        position: p.position,
        final: withFinal(plain),
        double: double && { ...double, savingsPct: savingsPct(double.perChance, base), final: withFinal(double) },
      };
    }),
  };
}

async function quoteForRaffle(raffleId, { packId, double, code }) {
  const { raffle, packs: list, offer, promos: allPromos } = await getConfig(raffleId);
  sales.assertOpen(raffle, 'El sorteo no está a la venta');
  const pack = list.find((p) => p.id === Number(packId));
  if (!pack) throw new HttpError(400, 'Pack inválido');
  const q = quote({ pack, offer, double: double === true });
  return promos.priceWithPromo({ promos: allPromos, q, code, mode: raffle.promoMode });
}

module.exports = { DEFAULT_PACKS, DEFAULT_OFFER, quote, validateConfig, getConfig, saveConfig, seedDefaults, publicView, quoteForRaffle };
