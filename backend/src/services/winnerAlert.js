const config = require('../config');
const { Raffle, Order, FreeEntry, Chance, Draw } = require('../db');
const { mailer } = require('./mailer');
const { esc } = require('./emailTemplates');
const { PROVINCES } = require('./provinces');

// Aviso al administrador cuando se carga un ganador: llegan TODOS los datos del formulario, para poder
// contactarlo aunque se cierre el panel. Usa el mismo patrón "outbox" que los comprobantes de compra:
// 1. Al guardar el sorteo, EN LA MISMA transacción, el aviso queda marcado "pending" en la base.
// 2. Después del commit se intenta enviar enseguida (deliverSoon), sin demorar ni romper el sorteo.
// 3. Si falla o el servidor se reinicia, el worker (processPending) lo reintenta con espera creciente.
// Nunca hay un aviso duplicado: cada envío "toma" el sorteo con un UPDATE condicional (claim).
const { Op } = require('sequelize');
const RETRY_MINUTES = [1, 5, 15, 60, 360];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const LEASE_MINUTES = 2;
const minutesFromNow = (m) => new Date(Date.now() + m * 60 * 1000);
const hasAdminEmail = () => !!config.admin.email && config.admin.email !== 'admin@local';

// Campos para crear el Draw: pendiente si hay a quién avisar
const pendingFields = () => (hasAdminEmail() ? { alertStatus: 'pending', alertAttempts: 0, alertNextAttemptAt: new Date() } : { alertStatus: 'none' });

const provinceName = (code) => PROVINCES.find((p) => p.code === code)?.name || '';
const when = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }) + ' h';

async function winnerData(raffleId, winner) {
  if (winner.source === 'free') {
    const f = winner.freeEntry;
    return [
      ['Origen', 'Participación gratuita'],
      ['Nombre y apellido', f.name],
      ['DNI', f.dni],
      ['Email', f.email],
      ['Teléfono', f.phone || '—'],
      ['Provincia', provinceName(f.province) || '—'],
      ['Confirmó su email', f.confirmedAt ? when(f.confirmedAt) : '—'],
    ];
  }
  const o = winner.order;
  const paid = o.status === 'manual' ? 'Venta manual' : 'Compra online';
  return [
    ['Origen', paid],
    ['Nombre y apellido', o.buyerName],
    ['DNI', o.buyerDni],
    ['Email', o.buyerEmail],
    ['Teléfono', o.buyerPhone],
    ['Provincia', provinceName(o.buyerProvince) || '—'],
    ['Curso', o.courseTitle || '—'],
    ['Chances de la compra', o.chances ? `${o.chances} (números ${o.firstNumber} al ${o.lastNumber})` : '—'],
    ['Monto', Number(o.amount).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })],
    ['Fecha de compra', when(o.createdAt)],
    ['ID de compra', o.id],
  ];
}

async function buildMail(raffleId, { number, winner, drawnAt }) {
  const raffle = await Raffle.findByPk(raffleId);
  const rows = [['Sorteo', raffle.title], ['Premio', raffle.prize], ['Número ganador', String(number)], ['Fecha del sorteo', when(drawnAt || new Date())], ...(await winnerData(raffleId, winner))];
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:560px">
<h2 style="margin:0 0 6px">🏆 Hay ganador: ${esc(raffle.title)}</h2>
<p style="margin:0 0 14px;color:#555">Datos completos tal como los cargó la persona. Guardá este mail: te sirve para contactarla.</p>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #ddd;background:#f6f6f6;width:38%"><b>${esc(k)}</b></td><td style="padding:6px 10px;border:1px solid #ddd">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:14px 0 0;font-size:12px;color:#777">El ganador debe acreditar su identidad con el DNI. Aviso automático para el administrador: no lo reenvíes, tiene datos personales.</p></div>`;
  const text = `Hay ganador: ${raffle.title}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nEl ganador debe acreditar su identidad con el DNI. Aviso solo para el administrador.`;
  return { subject: `🏆 Ganador del sorteo "${raffle.title}": número ${number}`, html, text };
}


// Arma el ganador a partir del número sorteado (la compra o participación gratuita dueña de ese número)
async function loadWinner(draw) {
  const chance = await Chance.findOne({ where: { RaffleId: draw.RaffleId, number: draw.number }, include: [Order, FreeEntry] });
  if (!chance) return null;
  return chance.FreeEntry ? { source: 'free', freeEntry: chance.FreeEntry } : { source: 'purchase', order: chance.Order };
}

async function claim(drawId) {
  const [count] = await Draw.update(
    { alertNextAttemptAt: minutesFromNow(LEASE_MINUTES), alertAttempts: Draw.sequelize.literal('"alertAttempts" + 1') },
    { where: { id: drawId, alertStatus: 'pending', alertNextAttemptAt: { [Op.lte]: new Date() } } }
  );
  return count === 1;
}

// Intenta enviar el aviso de un sorteo. Devuelve 'sent', 'retry', 'failed' o 'skipped'.
async function deliver(drawId) {
  if (!(await claim(drawId))) return 'skipped'; // ya enviado, no le toca todavía o lo tomó otro proceso
  const draw = await Draw.findByPk(drawId);
  try {
    if (draw.supersededAt || !hasAdminEmail()) {
      // un sorteo repetido ya reemplazó a este: avisar del anterior solo confunde
      await draw.update({ alertStatus: 'none', alertNextAttemptAt: null });
      return 'skipped';
    }
    const winner = await loadWinner(draw);
    if (!winner) throw new Error('no se encontró el ganador del número sorteado');
    const mail = await buildMail(draw.RaffleId, { number: draw.number, winner, drawnAt: draw.createdAt });
    await mailer.send({ to: config.admin.email, ...mail });
    await draw.update({ alertStatus: 'sent', alertSentAt: new Date(), alertNextAttemptAt: null, alertLastError: null });
    return 'sent';
  } catch (err) {
    const attempts = draw.alertAttempts;
    const failed = attempts >= MAX_ATTEMPTS;
    await draw.update({
      alertStatus: failed ? 'failed' : 'pending',
      alertNextAttemptAt: failed ? null : minutesFromNow(RETRY_MINUTES[attempts - 1]),
      alertLastError: String(err.message || err).slice(0, 500),
    });
    console.error(`[mail] falló el aviso del ganador al administrador (sorteo ${drawId}, intento ${attempts}):`, err.message);
    return failed ? 'failed' : 'retry';
  }
}

// Envío inmediato después del commit: nunca hace fallar al que lo llama
const deliverSoon = (drawId) =>
  deliver(drawId).catch((err) => {
    console.error('[mail] error inesperado en el aviso de ganador', err);
    return 'error';
  });

// Reintento periódico (lo llama el worker de mails): toma los avisos pendientes a los que ya les toca
async function processPending(limit = 20) {
  const due = await Draw.findAll({ where: { alertStatus: 'pending', alertNextAttemptAt: { [Op.lte]: new Date() } }, attributes: ['id'], limit });
  const out = [];
  for (const { id } of due) out.push(await deliver(id));
  return out;
}

module.exports = { pendingFields, deliver, deliverSoon, processPending, buildMail, RETRY_MINUTES, MAX_ATTEMPTS };
