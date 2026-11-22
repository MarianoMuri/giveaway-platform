// Genera la clave de la doble verificación del administrador.
// Uso (en la carpeta backend):  node scripts/two-factor-setup.js tu@mail.com
// No guarda nada: muestra la clave para cargarla en Railway como ADMIN_TOTP_SECRET y en la app de autenticación.
const { generateSecret, otpauthUrl } = require('../src/services/totp');

const account = process.argv[2] || 'admin';
const secret = generateSecret();
console.log('\n1) En Railway, servicio de la API → Variables: crear ADMIN_TOTP_SECRET con este valor:\n');
console.log(`   ${secret}\n`);
console.log('2) En tu celular, abrí Google Authenticator (o Authy / Microsoft Authenticator):');
console.log('   "+" → "Ingresar clave de configuración" → nombre: Sorteos → pegá la misma clave → tipo: basada en tiempo.\n');
console.log('   (Si tu app acepta enlaces, también sirve: ' + otpauthUrl(secret, account) + ')\n');
console.log('3) Cuando Railway termine de publicar, al entrar al panel te va a pedir el código de 6 números.\n');
console.log('Guardá la clave en un lugar seguro: con ella se puede volver a armar la app si cambiás de celular.\n');
