const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

// Almacenamiento de archivos (PDF de los cursos).
// Interfaz: save(buffer, ext) -> key · stream(key) · remove(key) · exists(key)
// Hoy guarda en disco local; para producción se puede implementar el mismo
// contrato sobre S3 / Cloudflare R2 sin cambiar el resto del código.

function localStorage(baseDir) {
  const root = path.resolve(baseDir);

  // Evita que una key maliciosa (../../etc/passwd) salga del directorio base
  function resolveKey(key) {
    if (!/^[a-f0-9]{32}\.[a-z0-9]{1,5}$/.test(key)) throw new Error('Key de archivo inválida');
    return path.join(root, key);
  }

  return {
    async save(buffer, ext) {
      await fsp.mkdir(root, { recursive: true });
      const key = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      await fsp.writeFile(resolveKey(key), buffer, { flag: 'wx' });
      return key;
    },
    stream(key) {
      return fs.createReadStream(resolveKey(key));
    },
    async exists(key) {
      try {
        await fsp.access(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
    async remove(key) {
      await fsp.rm(resolveKey(key), { force: true });
    },
  };
}

module.exports = localStorage(config.storageDir);
module.exports.localStorage = localStorage;
