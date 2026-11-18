const nodemailer = require('nodemailer');
const config = require('../config');

// Transporte de email. Con SMTP_URL usa SMTP (Resend, Brevo, Gmail, etc.);
// sin configurar, muestra el mail en la consola. Se puede reemplazar en tests.
let transport;
function getTransport() {
  if (!transport) {
    transport = config.mail.smtpUrl
      ? nodemailer.createTransport(config.mail.smtpUrl)
      : nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

const mailer = {
  async send({ to, subject, html, text }) {
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
