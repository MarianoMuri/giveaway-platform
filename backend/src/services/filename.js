// El navegador manda el nombre del archivo en UTF-8, pero multer lo interpreta como latin1
// ("Cómo" llega como "CÃ³mo"). Se deshace ese error; si el nombre ya estaba bien, se deja igual.
function fixFilename(name) {
  const s = String(name || '');
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const decoded = Buffer.from(s, 'latin1').toString('utf8');
  return decoded.includes('�') ? s : decoded;
}

module.exports = { fixFilename };
