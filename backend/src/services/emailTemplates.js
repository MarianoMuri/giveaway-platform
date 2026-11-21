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
 * Email con el link mágico de "Mis números".
 * @returns {{ subject: string, html: string, text: string }}
 */
function accessLink({ brand, url, minutes, count }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(brand.color) ? brand.color : '#e3262f';
  const subject = 'Tu link para ver tus números';
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
    <h1 style="margin:0 0 8px;font-size:22px;color:#18181b">Entrá a tus números</h1>
    <p style="margin:0 0 12px;color:#52525b;font-size:15px">Encontramos ${esc(plural)} con este email. Tocá el botón para ver tus números y descargar tus cursos.</p>
    ${button(url, 'Ver mis números', color)}
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">El link vence en ${esc(minutes)} minutos. Si no lo pediste vos, ignorá este email: nadie puede ver tus números sin este link.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    'Entrá a tus números',
    '',
    `Encontramos ${plural} con este email. Abrí este link para ver tus números y descargar tus cursos:`,
    url,
    '',
    `El link vence en ${minutes} minutos. Si no lo pediste vos, ignorá este email.`,
  ].join('\n');

  return { subject, html, text };
}

// Estructura común de los emails simples: cabecera con la marca y un bloque de contenido
function shell({ brand, color, subject, inner }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0d0d0f;padding:20px 24px;text-align:center">
    ${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="48" style="height:48px;border:0">` : `<span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:2px">${esc(brand.name)}</span>`}
  </td></tr>
  <tr><td style="padding:28px 24px;text-align:center">${inner}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#e3262f');

/**
 * Email para confirmar la participación gratuita (el número se asigna al abrir el link).
 * @returns {{ subject: string, html: string, text: string }}
 */
function freeEntryConfirm({ brand, url, hours, raffle }) {
  const color = safeColor(brand.color);
  const subject = 'Confirmá tu participación gratuita';
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;color:#18181b">Confirmá tu email</h1>
    <p style="margin:0 0 12px;color:#52525b;font-size:15px">Para sumarte gratis al sorteo del <strong>${esc(raffle.prize)}</strong>, confirmá tu email. Tu número se asigna cuando lo hagas.</p>
    ${button(url, 'Confirmar y recibir mi número', color)}
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">El link vence en ${esc(hours)} horas. Si no pediste participar, ignorá este email.</p>`;
  const text = [
    'Confirmá tu email',
    '',
    `Para sumarte gratis al sorteo del ${raffle.prize}, abrí este link. Tu número se asigna cuando lo hagas:`,
    url,
    '',
    `El link vence en ${hours} horas. Si no pediste participar, ignorá este email.`,
  ].join('\n');
  return { subject, html: shell({ brand, color, subject, inner }), text };
}

/**
 * Email con el número de la participación gratuita ya confirmada.
 * @returns {{ subject: string, html: string, text: string }}
 */
function freeEntryNumber({ brand, entry, raffle }) {
  const color = safeColor(brand.color);
  const firstName = String(entry.name).split(' ')[0];
  const subject = `Tu número para el sorteo: ${entry.number}`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;color:#18181b">¡Ya estás participando, ${esc(firstName)}!</h1>
    <p style="margin:0 0 12px;color:#52525b;font-size:15px">Este es tu número gratuito para el sorteo del <strong>${esc(raffle.prize)}</strong>.</p>
    <div style="border:2px solid ${color};border-radius:12px;padding:16px;margin:0 auto 12px;max-width:260px">
      <div style="font-size:34px;font-weight:800;color:${color};letter-spacing:1px">${esc(entry.number)}</div>
    </div>
    <p style="margin:0;font-size:14px;color:#3f3f46">Sorteo: ${esc(dateTime(raffle.drawDate))}</p>
    ${raffle.youtubeUrl ? `<p style="margin:8px 0 0;font-size:14px"><a href="${esc(raffle.youtubeUrl)}" style="color:${color}">Mirá el sorteo en vivo en YouTube</a></p>` : ''}
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">Guardá este email: es tu comprobante. Recordá que el ganador debe acreditar su identidad con el DNI.${raffle.permitNumber ? ` Autorización N° ${esc(raffle.permitNumber)}.` : ''}</p>`;
  const text = [
    `¡Ya estás participando, ${firstName}!`,
    '',
    `Tu número gratuito: ${entry.number}`,
    `Sorteo: ${raffle.title} - ${raffle.prize}`,
    `Fecha del sorteo: ${dateTime(raffle.drawDate)}`,
    raffle.youtubeUrl ? `Sorteo en vivo: ${raffle.youtubeUrl}` : null,
    '',
    'Guardá este email: es tu comprobante. El ganador debe acreditar su identidad con el DNI.',
  ].filter((l) => l !== null).join('\n');
  return { subject, html: shell({ brand, color, subject, inner }), text };
}

/**
 * Emails del arrepentimiento: constancia al comprador, resolución (devuelto o rechazado) y aviso al administrador.
 * kind: received | approved | rejected | admin
 * @returns {{ subject: string, html: string, text: string }}
 */
function withdrawalMail({ brand, kind, code, courseTitle, note, panelUrl }) {
  const color = safeColor(brand.color);
  const titles = {
    received: 'Recibimos tu solicitud de arrepentimiento',
    approved: 'Tu arrepentimiento fue aceptado',
    rejected: 'Respuesta a tu solicitud de arrepentimiento',
    admin: 'Nueva solicitud de arrepentimiento',
  };
  const bodies = {
    received: [`Registramos tu solicitud ${code} sobre la compra del curso "${courseTitle}". La revisamos y te respondemos por este medio.`, 'Guardá este email: es tu constancia.'],
    approved: [`Aceptamos tu solicitud ${code}. Te devolvemos el importe por el mismo medio de pago que usaste; el plazo depende de tu banco o tarjeta.`, 'Tus chances de esa compra quedaron anuladas.'],
    rejected: [`No pudimos aceptar tu solicitud ${code}.`, note ? `Motivo: ${note}` : null],
    admin: [`Solicitud ${code} sobre el curso "${courseTitle}".`, 'Revisala en el panel para devolver el dinero o responder.'],
  };
  const lines = bodies[kind].filter(Boolean);
  const subject = `${titles[kind]} (${code})`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;color:#18181b">${esc(titles[kind])}</h1>
    ${lines.map((l) => `<p style="margin:0 0 10px;color:#52525b;font-size:15px">${esc(l)}</p>`).join('')}
    ${kind === 'admin' && panelUrl ? button(panelUrl, 'Abrir el panel', color) : ''}`;
  const text = [titles[kind], '', ...lines, kind === 'admin' && panelUrl ? `\nPanel: ${panelUrl}` : null].filter((l) => l !== null).join('\n');
  return { subject, html: shell({ brand, color, subject, inner }), text };
}

/**
 * Aviso interno al administrador: la conexión con Mercado Pago se cayó, sigue caída o se recuperó.
 * @returns {{ subject: string, html: string, text: string }}
 */
function mpAlert({ brand, kind, reason, since, panelUrl }) {
  const color = safeColor(brand.color);
  const down = kind !== 'recovered';
  const subject =
    kind === 'recovered' ? 'Mercado Pago: la conexión se recuperó'
      : kind === 'reminder' ? 'Mercado Pago sigue caído: se siguen sin poder cobrar compras'
        : 'Alerta: se cayó la conexión con Mercado Pago';
  const lines = down
    ? [
        'Mientras la conexión esté caída no se pueden cobrar compras nuevas.',
        'Los pagos que ya se hicieron no se pierden: cuando se recupere, el botón "Consultar" del sorteo carga los que falten.',
      ]
    : ['Ya se pueden cobrar compras de nuevo. Si hubo compras durante la caída, conviene usar "Consultar" en el sorteo para verificar que estén todas cargadas.'];
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;color:${down ? '#b91c1c' : '#15803d'}">${esc(subject)}</h1>
    ${down ? `<p style="margin:0 0 6px;color:#52525b;font-size:15px"><strong>Motivo:</strong> ${esc(reason)}</p>` : ''}
    ${since ? `<p style="margin:0 0 12px;color:#71717a;font-size:13px">Desde: ${esc(dateTime(since))}</p>` : ''}
    ${lines.map((l) => `<p style="margin:0 0 10px;color:#52525b;font-size:15px">${esc(l)}</p>`).join('')}
    ${panelUrl ? button(panelUrl, 'Abrir el panel', color) : ''}`;
  const text = [subject, '', down ? `Motivo: ${reason}` : null, since ? `Desde: ${dateTime(since)}` : null, '', ...lines, panelUrl ? `\nPanel: ${panelUrl}` : null]
    .filter((l) => l !== null)
    .join('\n');
  return { subject, html: shell({ brand, color, subject, inner }), text };
}

module.exports = { purchaseConfirmation, accessLink, freeEntryConfirm, freeEntryNumber, mpAlert, withdrawalMail, esc };
