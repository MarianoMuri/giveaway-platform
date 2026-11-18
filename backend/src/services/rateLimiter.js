// Limitador de velocidad: reparte los envíos a un ritmo máximo por segundo, porque los proveedores
// de email (Resend, Brevo...) rechazan o frenan a quien manda más rápido que su límite.
// Funciona reservando "turnos" separados por 1/perSecond segundos. perSecond = 0 desactiva el límite.
function createLimiter({ perSecond, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const interval = perSecond > 0 ? 1000 / perSecond : 0;
  let next = 0;

  // Reserva el próximo turno y devuelve cuántos ms hay que esperar. Si la espera supera maxWaitMs,
  // no reserva nada y devuelve null (hay demasiada cola).
  function reserve(maxWaitMs = Infinity) {
    if (!interval) return 0;
    const t = now();
    const start = Math.max(t, next);
    if (start - t > maxWaitMs) return null;
    next = start + interval;
    return start - t;
  }

  async function acquire() {
    const wait = reserve();
    if (wait > 0) await sleep(wait);
  }

  return { perSecond, reserve, acquire };
}

module.exports = { createLimiter };
