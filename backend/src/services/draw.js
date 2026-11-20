const crypto = require('crypto');
const { sequelize, Raffle, Chance, Draw } = require('../db');
const { HttpError, drawWinner, assertClosedForDraw } = require('./orders');
const audit = require('./audit');

const MAX_ATTEMPTS = 5;

function cleanReason(raffle, reason) {
  if (raffle.status !== 'drawn') return null;
  const r = String(reason || '').trim();
  if (!r) throw new HttpError(409, 'Ya hay un ganador. Para repetir el sorteo indicá el motivo.');
  if (r.length < 5) throw new HttpError(400, 'El motivo es muy corto: explicá por qué se repite el sorteo');
  return r.slice(0, 300);
}

async function saveDraw(raffleId, { number, method, validCount = null, position = null, actor, reason }) {
  const row = await sequelize.transaction(async (t) => {
    await Draw.update({ supersededAt: new Date() }, { where: { RaffleId: raffleId, supersededAt: null }, transaction: t });
    return Draw.create({ RaffleId: raffleId, number, method, validCount, position, actor, reason }, { transaction: t });
  });
  return row;
}

// Sorteo en vivo: el servidor elige al azar, con generador criptográfico, entre los números VÁLIDOS
// (pagos acreditados y participaciones gratuitas confirmadas; los anulados no participan).
async function drawRandom(raffleId, { actor, ip, reason }) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  assertClosedForDraw(raffle);
  const why = cleanReason(raffle, reason);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const validCount = await Chance.count({ where: { RaffleId: raffleId, status: 'valid' } });
    if (!validCount) throw new HttpError(409, 'No hay números válidos para sortear');
    const position = crypto.randomInt(validCount);
    const chance = await Chance.findOne({ where: { RaffleId: raffleId, status: 'valid' }, order: [['number', 'ASC']], offset: position });
    try {
      const result = await drawWinner(raffleId, chance.number, { redraw: raffle.status === 'drawn', expect: raffle });
      const draw = await saveDraw(raffleId, { number: chance.number, method: 'random', validCount, position, actor, reason: why });
      await audit.record({ actor, ip, raffleId, action: why ? 'draw.redo' : 'draw.run', detail: `number=${chance.number}, valid=${validCount}, position=${position}${why ? `, reason=${why}` : ''}` });
      return { ...result, draw };
    } catch (e) {
      // Si al verificar su pago en Mercado Pago el número quedó anulado, se descarta y se vuelve a sortear
      const now = await Chance.findOne({ where: { RaffleId: raffleId, number: chance.number } });
      if (e.status === 409 && now && now.status === 'void') {
        await audit.record({ actor, ip, raffleId, action: 'draw.discarded', detail: `number=${chance.number}, motivo=anulado al verificar el pago` });
        continue;
      }
      throw e;
    }
  }
  throw new HttpError(503, 'No se pudo completar el sorteo: varios números salieron anulados. Reintentá.');
}

// Ganador cargado a mano (sorteo hecho por otro medio)
async function loadManual(raffleId, number, { actor, ip, reason }) {
  const raffle = await Raffle.findByPk(raffleId);
  if (!raffle) throw new HttpError(404, 'Sorteo inexistente');
  const why = cleanReason(raffle, reason);
  const result = await drawWinner(raffleId, number, { redraw: raffle.status === 'drawn', expect: raffle });
  const draw = await saveDraw(raffleId, { number: result.number, method: 'manual', actor, reason: why });
  await audit.record({ actor, ip, raffleId, action: why ? 'winner.manual_redo' : 'winner.manual', detail: `number=${result.number}${why ? `, reason=${why}` : ''}` });
  return { ...result, draw };
}

const listDraws = (raffleId) => Draw.findAll({ where: { RaffleId: raffleId }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });

module.exports = { drawRandom, loadManual, listDraws };
