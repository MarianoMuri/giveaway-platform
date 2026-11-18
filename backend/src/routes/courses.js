const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const requireAdmin = require('../middleware/auth');
const storage = require('../services/storage');
const { Course } = require('../db');
const svc = require('../services/courses');
const { HttpError } = require('../services/orders');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// En memoria: el archivo se valida antes de tocar el disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPdfMb * 1024 * 1024, files: 1 },
}).single('pdf');

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `El PDF supera los ${config.maxPdfMb} MB`));
    next(new HttpError(400, err.message));
  });
}

// ---- Público ----
const publicRouter = express.Router();
const downloadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 });

publicRouter.get('/', wrap(async (req, res) => {
  res.json(await Course.findAll({
    where: { active: true },
    attributes: svc.publicFields,
    order: [['position', 'ASC'], ['createdAt', 'ASC']],
  }));
}));

publicRouter.get('/download', downloadLimiter, wrap(async (req, res) => {
  const course = await svc.resolveDownload(req.query.token);
  res.set('Content-Type', 'application/pdf');
  res.set('Cache-Control', 'private, no-store');
  res.attachment(course.pdfName);
  storage.stream(course.pdfKey).on('error', () => res.destroy()).pipe(res);
}));

// ---- Admin ----
const adminRouter = express.Router();
adminRouter.use(requireAdmin);

adminRouter.get('/', wrap(async (req, res) => {
  res.json(await Course.findAll({ order: [['position', 'ASC'], ['createdAt', 'ASC']] }));
}));

adminRouter.post('/', handleUpload, wrap(async (req, res) => {
  res.status(201).json(await svc.createCourse(req.body || {}, req.file));
}));

adminRouter.patch('/:id', handleUpload, wrap(async (req, res) => {
  res.json(await svc.updateCourse(req.params.id, req.body || {}, req.file));
}));

adminRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteCourse(req.params.id);
  res.status(204).end();
}));

// Link de prueba para que el admin verifique qué recibe el comprador
adminRouter.post('/:id/download-link', wrap(async (req, res) => {
  const course = await Course.findByPk(req.params.id);
  if (!course) throw new HttpError(404, 'Curso no encontrado');
  res.json({ url: svc.downloadUrl(course.id, 1) });
}));

module.exports = { publicRouter, adminRouter };
