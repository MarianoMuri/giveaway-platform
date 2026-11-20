const config = require('../config');
const { Raffle, Order, FreeEntry } = require('../db');
const { mailer } = require('./mailer');
const { esc } = require('./emailTemplates');
const { PROVINCES } = require('./provinces');

// Aviso al administrador cuando se carga un ganador: llegan TODOS los datos del formulario, para poder
// contactarlo aunque se cierre el panel. Se manda después de guardar el sorteo y nunca lo hace fallar:
// si el proveedor de mail está caído se reintenta unas veces y, si no se puede, queda el aviso en el log
// (los datos siguen disponibles en el panel).
const RETRY_MS = [0, 5000, 30000];

const provinceName = (code) => PROVINCES.find((p) => p.code === code)?.name || '';
const when = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }) + ' h';

async function winnerData(raffleId, winner) {
  if (winner.source === 'free') {
    const f = await FreeEntry.findByPk(winner.freeEntryId);
    return [
      ['Origen', 'Participación gratuita'],
      ['Nombre y apellido', f.name],
      ['DNI', f.dni],
      ['Email', f.email],
      ['Teléfono', '— (la participación gratuita no lo pide)'],
      ['Provincia', provinceName(f.province) || '—'],
      ['Confirmó su email', f.confirmedAt ? when(f.confirmedAt) : '—'],
    ];
  }
  const o = await Order.findByPk(winner.orderId);
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

async function buildMail(raffleId, { number, winner }) {
  const raffle = await Raffle.findByPk(raffleId);
  const rows = [['Sorteo', raffle.title], ['Premio', raffle.prize], ['Número ganador', String(number)], ['Fecha del sorteo', when(new Date())], ...(await winnerData(raffleId, winner))];
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:560px">
<h2 style="margin:0 0 6px">🏆 Hay ganador: ${esc(raffle.title)}</h2>
<p style="margin:0 0 14px;color:#555">Datos completos tal como los cargó la persona. Guardá este mail: te sirve para contactarla.</p>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #ddd;background:#f6f6f6;width:38%"><b>${esc(k)}</b></td><td style="padding:6px 10px;border:1px solid #ddd">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:14px 0 0;font-size:12px;color:#777">El ganador debe acreditar su identidad con el DNI. Aviso automático para el administrador: no lo reenvíes, tiene datos personales.</p></div>`;
  const text = `Hay ganador: ${raffle.title}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nEl ganador debe acreditar su identidad con el DNI. Aviso solo para el administrador.`;
  return { subject: `🏆 Ganador del sorteo "${raffle.title}": número ${number}`, html, text };
}

async function send(raffleId, result) {
  const to = config.admin.email;
  if (!to || to === 'admin@local') return 'skipped';
  const mail = await buildMail(raffleId, result);
  for (let i = 0; i < RETRY_MS.length; i += 1) {
    if (RETRY_MS[i]) await new Promise((r) => setTimeout(r, RETRY_MS[i]).unref());
    try {
      await mailer.send({ to, ...mail });
      return 'sent';
    } catch (err) {
      console.error(`[mail] no se pudo avisar el ganador al administrador (intento ${i + 1}/${RETRY_MS.length}):`, err.message);
    }
  }
  return 'failed';
}

// Se llama sin esperar (no demora la pantalla del sorteo) y nunca lanza error
const notify = (raffleId, result) =>
  send(raffleId, result).catch((err) => {
    console.error('[mail] error inesperado en el aviso de ganador', err);
    return 'error';
  });

module.exports = { notify, send, buildMail };
