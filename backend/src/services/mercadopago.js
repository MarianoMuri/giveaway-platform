const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment, Order: MpOrder } = require('mercadopago');
const config = require('../config');

let client;
function getClient() {
  if (!client) client = new MercadoPagoConfig({ accessToken: config.mp.accessToken });
  return client;
}

const money = (n) => Number(n).toFixed(2);
// Los ids de la API de Orders empiezan con "ORD"; los de la API de pagos son numéricos.
const isOrderId = (id) => /^ORD/i.test(String(id));

// Las credenciales de prueba también empiezan con APP_USR-, pero las órdenes que crean tienen un
// id con prefijo ORDTST. Si pasara en producción, el comprador iría a pagar a un checkout de mentira.
const isTestOrderId = (id) => /^ORDTST/i.test(String(id));
function assertLiveOrder(id) {
  if (isTestOrderId(id) && !config.mp.allowTest) {
    throw new Error('Mercado Pago está con credenciales de prueba. Cargá las de producción o definí ALLOW_MP_TEST=true en un entorno de pruebas');
  }
}

// Estado de una orden de Mercado Pago -> el estado que ya entiende el resto del sistema
// (el de un pago). Así la lógica de números, mails y anulaciones no cambia.
const ORDER_STATUS = {
  processed: 'approved', // acreditado (también si hubo un reintegro parcial)
  refunded: 'refunded',
  charged_back: 'charged_back',
  failed: 'rejected',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  expired: 'cancelled',
  processing: 'in_process',
  action_required: 'pending', // esperando que el comprador pague (ej. efectivo)
  created: 'pending',
};

function fromOrder(o) {
  const paid = Number(o.total_paid_amount);
  return {
    id: String(o.id),
    status: ORDER_STATUS[o.status] || 'pending',
    statusDetail: o.status_detail,
    externalReference: o.external_reference,
    amount: paid > 0 ? paid : Number(o.total_amount),
  };
}

// Cuerpo de POST /v1/orders (Checkout Pro). Un solo ítem con el total que calculó el backend.
function orderBody({ order, title }) {
  const back = `${config.frontendUrl}/compra/${order.id}`;
  return {
    type: 'online',
    processing_mode: 'manual',
    total_amount: money(order.amount),
    external_reference: order.id,
    description: title.slice(0, 250),
    payer: { email: order.buyerEmail },
    items: [{ title: title.slice(0, 250), unit_price: money(order.amount), quantity: 1 }],
    config: { online: { success_url: back, pending_url: back, failure_url: back, auto_return: 'approved' } },
  };
}

// Se puede reemplazar en tests.
const mp = {
  // Crea el checkout y devuelve { id, initPoint }. El aviso de pago llega al webhook que se
  // configura en el panel de Mercado Pago (evento "Order"), el mismo donde está la clave secreta.
  async createCheckout({ order, title }) {
    if (config.mp.api === 'preferences') return createPreference({ order, title });
    const created = await new MpOrder(getClient()).create({
      body: orderBody({ order, title }),
      // La misma compra siempre usa la misma clave: un reintento no crea una orden duplicada
      requestOptions: { idempotencyKey: order.id },
    });
    assertLiveOrder(created.id);
    return { id: created.id, initPoint: created.checkout_url };
  },

  // Pagos de una compra (por external_reference): sirve para controlar, antes de sortear, que no
  // falte cargar ninguno aunque el aviso (webhook) se haya perdido
  async searchPayments(externalReference) {
    if (config.mp.api === 'orders') {
      const now = new Date();
      const r = await new MpOrder(getClient()).search({
        options: {
          external_reference: externalReference,
          begin_date: new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString(),
          end_date: now.toISOString(),
        },
      });
      const found = (r.data || r.results || [])
        .filter((o) => o.status !== 'created') // "created" = entró al checkout y no pagó
        .map((o) => {
          const p = fromOrder(o);
          return { id: p.id, status: p.status };
        });
      if (found.length) return found;
      // compras hechas antes de migrar (con la API anterior)
    }
    const r = await new Payment(getClient()).search({
      options: { external_reference: externalReference, sort: 'date_created', criteria: 'desc' },
    });
    return (r.results || []).map((p) => ({ id: String(p.id), status: p.status }));
  },

  // Llamada barata y autenticada (lista 1 pago): si las credenciales están mal o Mercado Pago no
  // responde, falla. La usa el monitor de conexión.
  async ping() {
    await new Payment(getClient()).search({ options: { limit: 1 } });
  },

  // Acepta ids de orden (ORD...) y de pago (numéricos): sirve para compras de las dos épocas
  async getPayment(id) {
    if (isOrderId(id)) return fromOrder(await new MpOrder(getClient()).get({ id: String(id) }));
    const p = await new Payment(getClient()).get({ id });
    return {
      id: String(p.id),
      status: p.status,
      statusDetail: p.status_detail,
      externalReference: p.external_reference,
      amount: Number(p.transaction_amount),
    };
  },
};

// API heredada (Preferences): queda disponible con MP_API=preferences
async function createPreference({ order, title }) {
  const pref = await new Preference(getClient()).create({
    body: {
      items: [
        {
          id: String(order.RaffleId),
          title: title.slice(0, 250),
          quantity: 1,
          unit_price: Number(order.amount),
          currency_id: 'ARS',
        },
      ],
      payer: { name: order.buyerName, email: order.buyerEmail },
      external_reference: order.id,
      notification_url: `${config.publicApiUrl}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${config.frontendUrl}/compra/${order.id}`,
        pending: `${config.frontendUrl}/compra/${order.id}`,
        failure: `${config.frontendUrl}/compra/${order.id}`,
      },
      auto_return: 'approved',
    },
  });
  return { id: pref.id, initPoint: pref.init_point };
}

// Validación de la firma x-signature de Mercado Pago.
// Manifest: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// El id de una orden es alfanumérico: se acepta tal cual y en minúsculas (la documentación
// de Mercado Pago no aclara cuál firma), las dos con la misma clave secreta.
function verifySignature({ signatureHeader, requestId, dataId }) {
  if (!config.mp.webhookSecret) return true; // sin secreto configurado (solo desarrollo)
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
  );
  if (!parts.ts || !parts.v1) return false;
  const b = Buffer.from(parts.v1);
  const ids = [...new Set([String(dataId), String(dataId).toLowerCase()])];
  return ids.some((id) => {
    let manifest = `id:${id};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${parts.ts};`;
    const a = Buffer.from(crypto.createHmac('sha256', config.mp.webhookSecret).update(manifest).digest('hex'));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

module.exports = { mp, verifySignature, fromOrder, orderBody, isOrderId, isTestOrderId, assertLiveOrder };
