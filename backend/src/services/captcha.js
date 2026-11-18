const config = require('../config');
const { HttpError } = require('./errors');

/**
 * Verificación de captcha con Cloudflare Turnstile (gratis, sin acertijos para el usuario).
 * El navegador resuelve el desafío y manda un token; el servidor lo valida con Cloudflare.
 * Sin TURNSTILE_SECRET no se exige (desarrollo y tests). `verify` se puede reemplazar en tests.
 */
const captcha = {
  enabled: () => Boolean(config.captcha.secret),
  async verify(token, ip) {
    if (!captcha.enabled()) return true;
    if (!token) throw new HttpError(400, 'Completá la verificación de seguridad');
    let data;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.captcha.secret, response: token, remoteip: ip }),
      });
      data = await res.json();
    } catch {
      throw new HttpError(503, 'No pudimos verificar que sos una persona. Probá de nuevo en un momento.');
    }
    if (!data.success) throw new HttpError(400, 'La verificación de seguridad falló. Probá de nuevo.');
    return true;
  },
};

module.exports = { captcha };
