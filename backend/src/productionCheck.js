// En producción la API no arranca con una configuración a medias: es mejor un error claro al desplegar
// que descubrir en plena venta que no salen los mails, que el captcha está apagado o que el webhook
// de Mercado Pago no se valida. Devuelve la lista de problemas (vacía si todo está bien).
function productionProblems(env = process.env) {
  const problems = [];
  const need = (name, why) => {
    if (!env[name]) problems.push(`${name}: ${why}`);
  };
  const notLocal = (name) => {
    if (env[name] && /localhost|127\.0\.0\.1/.test(env[name])) problems.push(`${name}: apunta a localhost, debe ser la URL pública`);
  };

  need('DATABASE_URL', 'conexión a PostgreSQL');
  need('ADMIN_EMAIL', 'email del administrador');
  need('ADMIN_PASSWORD_HASH', 'hash bcrypt de la contraseña del administrador');
  if (!env.JWT_SECRET) problems.push('JWT_SECRET: falta');
  else if (env.JWT_SECRET.length < 32) problems.push('JWT_SECRET: debe tener al menos 32 caracteres');
  else if (/cambiar|dev-secret/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET: es el valor de ejemplo, generá uno propio');
  need('FRONTEND_URL', 'dominio del sitio (CORS y links de los emails)');
  need('PUBLIC_API_URL', 'URL pública de la API (webhook de Mercado Pago)');
  notLocal('FRONTEND_URL');
  notLocal('PUBLIC_API_URL');
  need('MP_ACCESS_TOKEN', 'credencial de Mercado Pago');
  if (env.MP_ACCESS_TOKEN && env.MP_ACCESS_TOKEN.startsWith('TEST-') && env.ALLOW_MP_TEST !== 'true') {
    problems.push('MP_ACCESS_TOKEN: es una credencial de prueba (TEST-). Para un entorno de pruebas, definir ALLOW_MP_TEST=true');
  }
  need('MP_WEBHOOK_SECRET', 'sin la clave secreta no se puede validar que los avisos vengan de Mercado Pago');
  need('SMTP_URL', 'sin SMTP no llegan los emails con los cursos y los números');
  need('TURNSTILE_SECRET', 'sin captcha, la participación gratuita queda abierta a bots');
  need('STORAGE_DIR', 'carpeta del volumen persistente donde viven los PDF (si no, se pierden en cada deploy)');
  return problems;
}

module.exports = { productionProblems };
