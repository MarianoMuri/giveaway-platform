const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ADMIN_EMAIL = 'admin@test';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('clave123', 4);
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-test-'));
process.env.MAX_PDF_MB = '1';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { sequelize, Course } = require('../src/db');
const { createDownloadToken } = require('../src/services/courses');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PDF2 = Buffer.from('%PDF-1.7\nsegunda version\n%%EOF');
const storedFiles = () => fs.readdirSync(process.env.STORAGE_DIR);
let auth;

test.before(async () => {
  await sequelize.sync({ force: true });
  const login = await request(app).post('/api/admin/login').send({ email: 'admin@test', password: 'clave123' });
  auth = { Authorization: `Bearer ${login.body.token}` };
});

test.after(() => fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }));

const createCourse = (fields = {}, file = PDF, name = 'curso.pdf') => {
  const req = request(app).post('/api/admin/courses').set(auth);
  for (const [k, v] of Object.entries({ title: 'Curso de Cocina', description: 'Recetas básicas', ...fields })) req.field(k, String(v));
  return file ? req.attach('pdf', file, name) : req;
};

test('el ABM de cursos requiere login', async () => {
  const res = await request(app).get('/api/admin/courses');
  assert.equal(res.status, 401);
});

test('crea un curso con su PDF y no expone la key del archivo al público', async () => {
  const res = await createCourse();
  assert.equal(res.status, 201);
  assert.equal(res.body.pdfName, 'curso.pdf');
  assert.equal(res.body.pdfSize, PDF.length);
  assert.equal(storedFiles().length, 1);

  const pub = await request(app).get('/api/courses');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.length, 1);
  assert.equal(pub.body[0].pdfKey, undefined);
  assert.equal(pub.body[0].pdfName, undefined);
});

test('rechaza archivos que no son PDF aunque digan .pdf', async () => {
  const before = storedFiles().length;
  const res = await createCourse({}, Buffer.from('MZ ejecutable disfrazado'), 'virus.pdf');
  assert.equal(res.status, 400);
  assert.equal(storedFiles().length, before);
});

test('rechaza curso sin PDF o sin título', async () => {
  assert.equal((await createCourse({}, null)).status, 400);
  assert.equal((await createCourse({ title: '' })).status, 400);
});

test('rechaza PDF que supera el tamaño máximo', async () => {
  const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10)]);
  const res = await createCourse({}, big);
  assert.equal(res.status, 413);
});

test('los cursos inactivos no aparecen en la página pública', async () => {
  const res = await createCourse({ title: 'Curso oculto', active: false });
  assert.equal(res.status, 201);
  const pub = await request(app).get('/api/courses');
  assert.ok(!pub.body.some((c) => c.title === 'Curso oculto'));
  const admin = await request(app).get('/api/admin/courses').set(auth);
  assert.ok(admin.body.some((c) => c.title === 'Curso oculto'));
});

test('descarga con link firmado; rechaza links vencidos, adulterados o de otro uso', async () => {
  const course = await Course.findOne({ where: { title: 'Curso de Cocina' } });

  const ok = await request(app).get('/api/courses/download').query({ token: createDownloadToken(course.id) }).buffer(true);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.match(ok.headers['content-disposition'], /attachment; filename="?curso\.pdf"?/);
  assert.deepEqual(Buffer.from(ok.body), PDF);

  const expired = jwt.sign({ purpose: 'course-download', courseId: course.id, exp: Math.floor(Date.now() / 1000) - 10 }, config.jwtSecret);
  assert.equal((await request(app).get('/api/courses/download').query({ token: expired })).status, 410);

  const forged = jwt.sign({ purpose: 'course-download', courseId: course.id }, 'otra-clave');
  assert.equal((await request(app).get('/api/courses/download').query({ token: forged })).status, 403);

  // Un token de sesión de admin no sirve como link de descarga
  const adminToken = jwt.sign({ email: 'admin@test', courseId: course.id }, config.jwtSecret);
  assert.equal((await request(app).get('/api/courses/download').query({ token: adminToken })).status, 403);

  assert.equal((await request(app).get('/api/courses/download')).status, 403);
});

test('un curso desactivado se sigue pudiendo descargar con un link válido', async () => {
  const course = await Course.findOne({ where: { title: 'Curso oculto' } });
  const res = await request(app).get('/api/courses/download').query({ token: createDownloadToken(course.id) });
  assert.equal(res.status, 200);
});

test('reemplazar el PDF borra el archivo anterior', async () => {
  const course = await Course.findOne({ where: { title: 'Curso de Cocina' } });
  const oldKey = course.pdfKey;
  const res = await request(app).patch(`/api/admin/courses/${course.id}`).set(auth)
    .field('title', 'Cocina 2.0').attach('pdf', PDF2, 'cocina-v2.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Cocina 2.0');
  assert.notEqual(res.body.pdfKey, oldKey);
  assert.ok(!storedFiles().includes(oldKey));

  const dl = await request(app).get('/api/courses/download').query({ token: createDownloadToken(course.id) }).buffer(true);
  assert.deepEqual(Buffer.from(dl.body), PDF2);
});

test('editar sin archivo mantiene el PDF; se puede desactivar', async () => {
  const course = await Course.findOne({ where: { title: 'Cocina 2.0' } });
  const res = await request(app).patch(`/api/admin/courses/${course.id}`).set(auth).send({ active: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.active, false);
  assert.equal(res.body.pdfKey, course.pdfKey);
});

test('eliminar un curso borra su PDF e invalida los links', async () => {
  const course = await Course.findOne({ where: { title: 'Cocina 2.0' } });
  const token = createDownloadToken(course.id);
  const res = await request(app).delete(`/api/admin/courses/${course.id}`).set(auth);
  assert.equal(res.status, 204);
  assert.ok(!storedFiles().includes(course.pdfKey));
  assert.equal((await request(app).get('/api/courses/download').query({ token })).status, 404);
  assert.equal((await request(app).delete(`/api/admin/courses/${course.id}`).set(auth)).status, 404);
});

test('el almacenamiento rechaza keys con path traversal', () => {
  const storage = require('../src/services/storage');
  assert.throws(() => storage.stream('../../etc/passwd'), /inválida/);
});

test('el nombre del PDF conserva las tildes y repara los que quedaron rotos', async () => {
  const { fixFilename } = require('../src/services/filename');
  assert.equal(fixFilename('CÃ³mo empezar a vender.pdf'), 'Cómo empezar a vender.pdf');
  assert.equal(fixFilename('Año nuevo.pdf'), 'Año nuevo.pdf');
  assert.equal(fixFilename('curso.pdf'), 'curso.pdf');
  const res = await createCourse({ title: 'Con tildes' }, PDF, 'Pastelería casera.pdf');
  assert.equal(res.status, 201);
  const course = await Course.findOne({ where: { title: 'Con tildes' } });
  assert.equal(course.pdfName, 'Pastelería casera.pdf');
});
