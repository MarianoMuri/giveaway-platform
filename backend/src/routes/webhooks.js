const router = require('express').Router();
const { verifySignature } = require('../services/mercadopago');
const { handlePayment } = require('../services/orders');

router.post('/mercadopago', async (req, res) => {
  const type = req.body?.type || req.query.type || req.query.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id;
  if (type !== 'payment' || !dataId) return res.sendStatus(200);

  const ok = verifySignature({
    signatureHeader: req.get('x-signature'),
    requestId: req.get('x-request-id'),
    dataId,
  });
  if (!ok) return res.sendStatus(401);

  try {
    await handlePayment(String(dataId));
    res.sendStatus(200);
  } catch (e) {
    console.error('Error procesando webhook MP', e);
    res.sendStatus(500); // MP reintenta
  }
});

module.exports = router;
