const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/public'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/admin', require('./routes/admin'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Error interno' : err.message, ...(err.extra || {}) });
});

module.exports = app;
