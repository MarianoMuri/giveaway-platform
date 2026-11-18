// Plantillas de email. HTML con tablas y estilos en línea: es lo único que
// renderizan bien todos los clientes de correo (Gmail, Outlook, Apple Mail).
// Todo dato que viene del usuario se escapa: un nombre como "<script>" no rompe el mail.

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const dateTime = (d) =>
  d
    ? new Date(d).toLocaleString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires',
      }) + ' h'
    : 'A confirmar';

const numbersText = (o) => (o.firstNumber === o.lastNumber ? String(o.firstNumber) : `${o.firstNumber} al ${o.lastNumber}`);

function row(label, value) {
  return `<tr><td style="padding:6px 0;color:#71717a;font-size:14px">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#18181b"><strong>${esc(value)}</strong></td></tr>`;
}

function button(href, label, color) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px auto"><tr><td style="border-radius:10px;background:${color}">
<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a>
</td></tr></table>`;
}

/**
 * Email de confirmación de compra.
 * @returns {{ subject: string, html: string, text: string }}
 */
function purchaseConfirmation({ order, raffle, brand, downloadUrl, orderUrl, linkHours }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(brand.color) ? brand.color : '#e3262f';
  const firstName = String(order.buyerName).split(' ')[0];
  const subject = `Tus números para el sorteo: ${numbersText(order)}`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0d0d0f;padding:20px 24px;text-align:center">
    ${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="48" style="height:48px;border:0">` : `<span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:2px">${esc(brand.name)}</span>`}
  </td></tr>
  <tr><td style="padding:28px 24px 8px;text-align:center">
    <h1 style="margin:0 0 8px;font-size:24px;color:#18181b">¡Ya estás participando, ${esc(firstName)}!</h1>
    <p style="margin:0;color:#52525b;font-size:15px">Recibimos tu pago. Estos son tus números para el sorteo del <strong>${esc(raffle.prize)}</strong>.</p>
  </td></tr>
  <tr><td style="padding:16px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:2px solid ${color};border-radius:12px"><tr><td style="padding:18px;text-align:center">
      <div style="font-size:13px;color:#71717a">Tus números</div>
      <div style="font-size:30px;font-weight:800;color:${color};letter-spacing:1px;margin:4px 0">${esc(numbersText(order))}</div>
      <div style="font-size:14px;color:#3f3f46">${esc(order.chances)} chances${order.double ? ' (con "Duplicá")' : ''}</div>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:8px 24px;text-align:center">
    <h2 style="margin:8px 0 4px;font-size:18px;color:#18181b">Tu curso: ${esc(order.courseTitle)}</h2>
    ${downloadUrl ? button(downloadUrl, 'Descargar el curso (PDF)', color) : ''}
    <p style="margin:4px 0 0;font-size:12px;color:#71717a">El link de descarga vence en ${esc(linkHours)} horas. Después podés descargarlo de nuevo desde <a href="${esc(orderUrl)}" style="color:${color}">tu compra</a>.</p>
  </td></tr>
  <tr><td style="padding:16px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7">
      ${row('Sorteo', raffle.title)}
      ${row('Fecha del sorteo', dateTime(raffle.drawDate))}
      ${row('Total pagado', money(order.amount))}
      ${row('Código de compra', String(order.id).slice(0, 8).toUpperCase())}
    </table>
  </td></tr>
  <tr><td style="padding:4px 24px 24px;text-align:center">
    ${raffle.youtubeUrl ? `<p style="margin:0 0 6px;font-size:14px"><a href="${esc(raffle.youtubeUrl)}" style="color:${color}">Mirá el sorteo en vivo en YouTube</a></p>` : ''}
    <p style="margin:0;font-size:14px"><a href="${esc(orderUrl)}" style="color:${color}">Ver mi compra</a>${brand.whatsapp ? ` · <a href="${esc(brand.whatsapp)}" style="color:${color}">¿Dudas? Escribinos</a>` : ''}</p>
  </td></tr>
  <tr><td style="background:#fafafa;padding:16px 24px;text-align:center;font-size:12px;color:#a1a1aa">
    Guardá este email: es tu comprobante. ${esc(brand.name)}${raffle.permitNumber ? ` · Autorización N° ${esc(raffle.permitNumber)}` : ''}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `¡Ya estás participando, ${firstName}!`,
    '',
    `Tus números: ${numbersText(order)} (${order.chances} chances${order.double ? ', con "Duplicá"' : ''})`,
    `Sorteo: ${raffle.title} - ${raffle.prize}`,
    `Fecha del sorteo: ${dateTime(raffle.drawDate)}`,
    `Curso: ${order.courseTitle}`,
    downloadUrl ? `Descargá el curso (vence en ${linkHours} h): ${downloadUrl}` : null,
    `Total pagado: ${money(order.amount)}`,
    `Código de compra: ${String(order.id).slice(0, 8).toUpperCase()}`,
    `Ver mi compra: ${orderUrl}`,
    raffle.youtubeUrl ? `Sorteo en vivo: ${raffle.youtubeUrl}` : null,
    '',
    'Guardá este email: es tu comprobante.',
  ].filter((l) => l !== null).join('\n');

  return { subject, html, text };
}

/**
 * Email con el link mágico de "Mis compras".
 * @returns {{ subject: string, html: string, text: string }}
 */
function accessLink({ brand, url, minutes, count }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(brand.color) ? brand.color : '#e3262f';
  const subject = 'Tu link para ver tus compras';
  const plural = count === 1 ? '1 compra' : `${count} compras`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0d0d0f;padding:20px 24px;text-align:center">
    ${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="48" style="height:48px;border:0">` : `<span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:2px">${esc(brand.name)}</span>`}
  </td></tr>
  <tr><td style="padding:28px 24px;text-align:center">
    <h1 style="margin:0 0 8px;font-size:22px;color:#18181b">Entrá a tus compras</h1>
    <p style="margin:0 0 12px;color:#52525b;font-size:15px">Encontramos ${esc(plural)} con este email. Tocá el botón para ver tus números y descargar tus cursos.</p>
    ${button(url, 'Ver mis compras', color)}
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">El link vence en ${esc(minutes)} minutos. Si no lo pediste vos, ignorá este email: nadie puede ver tus compras sin este link.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    'Entrá a tus compras',
    '',
    `Encontramos ${plural} con este email. Abrí este link para ver tus números y descargar tus cursos:`,
    url,
    '',
    `El link vence en ${minutes} minutos. Si no lo pediste vos, ignorá este email.`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { purchaseConfirmation, accessLink, esc };
