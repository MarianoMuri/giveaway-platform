const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const config = require('../config');

let client;
function getClient() {
  if (!client) client = new MercadoPagoConfig({ accessToken: config.mp.accessToken });
  return client;
}

// Se puede reemplazar en tests.
const mp = {
  // title: descripción que ve el comprador en el checkout.
  // Si la orden tiene vencimiento (grilla con reserva), el link de pago vence con ella
  // y se excluyen los medios en efectivo, que se acreditan días después.
  async createPreference({ order, raffle, title }) {
    const expiring = Boolean(order.expiresAt);
    const pref = await new Preference(getClient()).create({
      body: {
        items: [
          {
            id: String(raffle.id),
            // Un solo ítem con el total: así se respetan las promos por cantidad
            title: (title || `${raffle.title} - ${order.numbers.length} número(s): ${order.numbers.join(', ')}`).slice(0, 250),
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
        ...(expiring && {
          expires: true,
          expiration_date_to: order.expiresAt.toISOString(),
          payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
        }),
      },
    });
    return { id: pref.id, initPoint: pref.init_point };
  },

  async getPayment(paymentId) {
    const p = await new Payment(getClient()).get({ id: paymentId });
    return {
      id: String(p.id),
      status: p.status,
      statusDetail: p.status_detail,
      externalReference: p.external_reference,
      amount: Number(p.transaction_amount),
    };
  },
};

// Validación de la firma x-signature de Mercado Pago.
// Manifest: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
function verifySignature({ signatureHeader, requestId, dataId }) {
  if (!config.mp.webhookSecret) return true; // sin secreto configurado (solo desarrollo)
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
  );
  if (!parts.ts || !parts.v1) return false;
  let manifest = `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', config.mp.webhookSecret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { mp, verifySignature };
