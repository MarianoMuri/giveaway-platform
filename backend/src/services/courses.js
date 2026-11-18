const jwt = require('jsonwebtoken');
const config = require('../config');
const storage = require('./storage');
const { Course } = require('../db');
const { HttpError } = require('./errors');

const PURPOSE = 'course-download';

// Los PDF se validan por contenido (magic bytes), no por extensión ni mimetype,
// que los manda el cliente y se pueden falsificar.
function assertPdf(file) {
  if (!file) throw new HttpError(400, 'Falta el archivo PDF');
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'El archivo no es un PDF válido');
  }
}

const publicFields = ['id', 'title', 'description', 'coverUrl', 'position'];

function pick(body) {
  const data = {};
  for (const k of ['title', 'description', 'coverUrl']) if (body[k] !== undefined) data[k] = String(body[k]).trim();
  if (body.active !== undefined) data.active = body.active === true || body.active === 'true';
  if (body.position !== undefined) data.position = Number(body.position) || 0;
  return data;
}

async function createCourse(body, file) {
  const data = pick(body);
  if (!data.title) throw new HttpError(400, 'El título es obligatorio');
  assertPdf(file);
  const pdfKey = await storage.save(file.buffer, 'pdf');
  try {
    return await Course.create({ ...data, pdfKey, pdfName: file.originalname, pdfSize: file.size });
  } catch (err) {
    await storage.remove(pdfKey); // no dejar archivos huérfanos si falla la DB
    throw err;
  }
}

async function updateCourse(id, body, file) {
  const course = await Course.findByPk(id);
  if (!course) throw new HttpError(404, 'Curso no encontrado');
  const data = pick(body);
  if (data.title === '') throw new HttpError(400, 'El título es obligatorio');
  let oldKey = null;
  if (file) {
    assertPdf(file);
    oldKey = course.pdfKey;
    Object.assign(data, { pdfKey: await storage.save(file.buffer, 'pdf'), pdfName: file.originalname, pdfSize: file.size });
  }
  await course.update(data);
  if (oldKey) await storage.remove(oldKey); // se borra el viejo recién cuando el nuevo quedó guardado
  return course;
}

async function deleteCourse(id) {
  const course = await Course.findByPk(id);
  if (!course) throw new HttpError(404, 'Curso no encontrado');
  await course.destroy();
  await storage.remove(course.pdfKey);
}

// Link firmado y con vencimiento: no hace falta guardar nada en la DB para validarlo
function createDownloadToken(courseId, hours = config.downloadLinkHours) {
  return jwt.sign({ purpose: PURPOSE, courseId }, config.jwtSecret, { expiresIn: `${hours}h` });
}

function downloadUrl(courseId, hours) {
  return `${config.publicApiUrl}/api/courses/download?token=${createDownloadToken(courseId, hours)}`;
}

async function resolveDownload(token) {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), config.jwtSecret);
  } catch (err) {
    throw new HttpError(err.name === 'TokenExpiredError' ? 410 : 403, err.name === 'TokenExpiredError' ? 'El link de descarga venció' : 'Link de descarga inválido');
  }
  if (payload.purpose !== PURPOSE) throw new HttpError(403, 'Link de descarga inválido');
  // Un curso desactivado se sigue pudiendo descargar: quien lo compró no lo pierde
  const course = await Course.findByPk(payload.courseId);
  if (!course || !(await storage.exists(course.pdfKey))) throw new HttpError(404, 'Curso no disponible');
  return course;
}

module.exports = { createCourse, updateCourse, deleteCourse, createDownloadToken, downloadUrl, resolveDownload, publicFields };
