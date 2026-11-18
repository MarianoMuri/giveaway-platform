const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { sequelize } = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '100kb' }));

// Lo usa el deploy para saber si la API está viva: responde 503 si no llega a la base
app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
const courses = require('./routes/courses');
app.use('/api/courses', courses.publicRouter);
app.use('/api/admin/courses', courses.adminRouter);
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
