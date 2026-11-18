const config = require('../config');
const { mp } = require('./mercadopago');
const { mailer } = require('./mailer');
const templates = require('./emailTemplates');

// Monitor de la conexión con Mercado Pago. Cada pocos minutos hace una llamada autenticada barata;
// si falla dos veces seguidas (para no alarmar por un tropiezo de red) marca la conexión como caída
// y avisa por email al administrador. Mientras siga caída recuerda cada 6 horas, y avisa al recuperarse.
// El estado vive en memoria: si el servidor se reinicia, vuelve a verificar y, si sigue caída, avisa de nuevo.
const FAILURES_TO_ALERT = 2;
const REMINDER_MS = 6 * 3600 * 1000;
const TIMEOUT_MS = 10 * 1000;

const REASONS = {
  credentials: 'Mercado Pago rechazó las credenciales (el token venció, fue revocado o está mal cargado).',
  unavailable: 'No se pudo comunicar con Mercado Pago (sin respuesta o con errores de su lado).',
};

let state;
function reset() {
  state = { status: config.mp.accessToken ? 'unknown' : 'not_configured', reason: null, checkedAt: null, since: null, failures: 0, lastAlertAt: null, alerted: false };
}
reset();

// 401/403 = las credenciales no sirven; cualquier otra cosa = Mercado Pago no disponible
function classify(err) {
  const status = Number(err?.status ?? err?.statusCode ?? err?.cause?.status ?? err?.response?.status);
  return status === 401 || status === 403 ? 'credentials' : 'unavailable';
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { status: 0 })), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function recipients() {
  return config.mpHealth.alertEmails.length ? config.mpHealth.alertEmails : [config.admin.email].filter((e) => e && e.includes('@'));
}

// Un fallo al mandar el aviso no rompe el monitor: queda en el log y se reintenta en el próximo chequeo
async function notify(kind, { reason, since }) {
  const to = recipients();
  if (!to.length) return false;
  const { subject, html, text } = templates.mpAlert({
    brand: config.brand, kind, reason: REASONS[reason] || reason, since, panelUrl: `${config.frontendUrl}/admin`,
  });
  try {
    await mailer.send({ to: to.join(', '), subject, html, text });
    return true;
  } catch (e) {
    console.error('[mp] no se pudo enviar el aviso de conexión', e.message);
    return false;
  }
}

async function check(now = new Date()) {
  if (!config.mp.accessToken) {
    state.status = 'not_configured';
    return getStatus();
  }
  state.checkedAt = now;
  try {
    await withTimeout(mp.ping());
    if (state.status === 'down') {
      const downSince = state.since;
      state.status = 'ok';
      state.failures = 0;
      state.reason = null;
      await notify('recovered', { since: downSince });
      state.since = now;
      state.lastAlertAt = null;
      state.alerted = false;
    } else {
      if (state.status !== 'ok') state.since = now;
      state.status = 'ok';
      state.failures = 0;
      state.reason = null;
    }
  } catch (e) {
    state.failures += 1;
    state.reason = classify(e);
    if (state.failures >= FAILURES_TO_ALERT) {
      if (state.status !== 'down') {
        state.status = 'down';
        state.since = now;
      }
      // Primer aviso apenas se cae; después, un recordatorio cada 6 horas. Si el email falla, se reintenta.
      if (!state.lastAlertAt || now - state.lastAlertAt >= REMINDER_MS) {
        if (await notify(state.alerted ? 'reminder' : 'down', { reason: state.reason, since: state.since })) {
          state.lastAlertAt = now;
          state.alerted = true;
        }
      }
    }
  }
  return getStatus();
}

function getStatus() {
  return {
    status: state.status, // ok | down | unknown | not_configured
    reason: state.reason ? REASONS[state.reason] : null,
    checkedAt: state.checkedAt,
    since: state.since,
    consecutiveFailures: state.failures,
  };
}

let timer;
function start() {
  if (timer || !config.mp.accessToken) return;
  const run = () => check().catch((e) => console.error('[mp] chequeo', e));
  setTimeout(run, 15 * 1000); // primer chequeo poco después de arrancar
  timer = setInterval(run, config.mpHealth.intervalMin * 60 * 1000);
  timer.unref?.();
}

module.exports = { check, getStatus, start, reset, classify, FAILURES_TO_ALERT, REMINDER_MS };
