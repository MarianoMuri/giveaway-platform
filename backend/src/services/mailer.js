const nodemailer = require('nodemailer');
const config = require('../config');

// Transporte de email. Con RESEND_API_KEY usa la API HTTPS de Resend; con SMTP_URL usa SMTP
// (Brevo, Gmail, etc.); sin configurar, muestra el mail en la consola. Se puede reemplazar en tests.
let transport;
function getTransport() {
  if (!transport) {
    transport = config.mail.smtpUrl
      ? nodemailer.createTransport(config.mail.smtpUrl, {
          // Conexiones reutilizadas: abrir una por mail no escala con miles de envíos
          pool: true,
          maxConnections: Math.max(1, config.email.concurrency),
          maxMessages: 100,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

// API HTTPS de Resend. Cualquier respuesta que no sea 2xx lanza un error: la cola de emails
// lo reintenta con espera creciente (429 = límite del plan, 5xx = caída del proveedor).
async function sendWithResend({ to, subject, html, text }) {
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, html, text, ...(config.mail.replyTo && { reply_to: config.mail.replyTo }) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error(`Resend no respondió: ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || 'error'}`);
  return { id: data.id };
}

const mailer = {
  async send({ to, subject, html, text }) {
    if (config.mail.resendApiKey) return sendWithResend({ to, subject, html, text });
    const info = await getTransport().sendMail({
      from: config.mail.from,
      replyTo: config.mail.replyTo,
      to,
      subject,
      html,
      text,
    });
    if (!config.mail.smtpUrl) console.log(`[mail] (sin SMTP) a ${to}: ${subject}`);
    return { id: info.messageId };
  },
};

module.exports = { mailer };
