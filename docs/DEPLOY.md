# Deploy a producción

Guía para publicar el sistema con **Railway** (API + PostgreSQL), **Netlify** (sitio) y el dominio del cliente.
Se hace primero en un **entorno de pruebas** (credenciales de prueba de Mercado Pago) y recién después en producción.

## Piezas

| Pieza | Dónde | Costo aproximado |
|---|---|---|
| API (Node) | Railway, servicio con la carpeta `backend` | Plan Hobby, unos USD 5/mes con la base |
| PostgreSQL | Railway, mismo proyecto | incluido en el uso del proyecto |
| Volumen de PDF | Railway, montado en `/data` | por GB de uso |
| Sitio (React) | Netlify, carpeta `frontend` | gratis |
| Emails | Resend o Brevo, con el dominio del cliente | plan gratuito alcanza para empezar |
| Captcha | Cloudflare Turnstile | gratis |

Las cuentas conviene dejarlas a nombre del cliente (o del titular del proyecto), no de una cuenta personal.

## Antes de empezar: qué hay que juntar

- [ ] Credenciales de **Mercado Pago**: Access Token y "Clave secreta" del webhook (de prueba primero, de producción al final)
- [ ] **Dominio** del cliente y acceso a su DNS (por ejemplo `sorteos.cliente.com.ar` para el sitio y `api.cliente.com.ar` para la API)
- [ ] Cuenta de **Resend o Brevo** con el dominio verificado (SPF y DKIM) y la URL SMTP
- [ ] **Cloudflare Turnstile**: clave pública (sitekey) y clave secreta, con el dominio del sitio
- [ ] Email y contraseña del **administrador**

Hash de la contraseña (se guarda el hash, nunca la contraseña):

```bash
node -e "console.log(require('bcryptjs').hashSync('LA-CLAVE-ELEGIDA', 10))"
```

Secreto para los tokens de sesión (32 caracteres o más):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 1. Railway: base de datos y API

1. Crear un proyecto nuevo y agregar **PostgreSQL**.
2. Agregar un servicio desde el repositorio de GitHub. En *Settings → Source* poner **Root Directory** = `backend`. Railway toma `backend/railway.json`, que ya define el build con Docker, el chequeo de salud (`/api/health`) y el comando de migración.
3. Crear un **volumen** y montarlo en `/data` (los PDF de los cursos viven ahí; sin volumen se pierden en cada deploy).
4. Cargar las variables del servicio (*Variables*):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` (ya viene en el Dockerfile) |
| `DATABASE_URL` | referencia a la variable de la base: `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | el secreto generado arriba |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | datos del administrador |
| `FRONTEND_URL` | URL del sitio, con `https://` y sin barra final |
| `PUBLIC_API_URL` | URL pública de la API, con `https://` |
| `MP_ACCESS_TOKEN` | credencial de Mercado Pago |
| `MP_WEBHOOK_SECRET` | clave secreta del webhook |
| `SMTP_URL` / `MAIL_FROM` / `MAIL_REPLY_TO` | datos del proveedor de emails |
| `EMAIL_RATE_PER_SEC` / `EMAIL_BATCH_SIZE` / `EMAIL_CONCURRENCY` | (opcionales) velocidad del envío de emails, ver [EMAIL.md](EMAIL.md) |
| `ALERT_EMAILS` | (opcional) a quién avisar si se cae la conexión con Mercado Pago, separados por coma; por defecto, `ADMIN_EMAIL` |
| `TURNSTILE_SECRET` | clave secreta de Turnstile |
| `STORAGE_DIR` | `/data/storage` |
| `BRAND_NAME`, `BRAND_COLOR`, `BRAND_LOGO_URL`, `BRAND_WHATSAPP_URL` | marca del cliente en los emails |
| `ALLOW_MP_TEST` | `true` **solo** en el entorno de pruebas con credenciales `TEST-` |

5. Desplegar. En cada deploy Railway corre `npm run migrate` antes de iniciar la API; si la migración falla, el deploy no se activa y la versión anterior sigue funcionando.
6. En *Settings → Networking* generar el dominio público (o agregar `api.cliente.com.ar`, ver paso 3).

La API **no arranca** si falta alguna variable importante o si hay valores de ejemplo: el log del deploy lista exactamente qué falta.

### Servicio de envío de emails (worker)

Para que un pico de compras no afecte al sitio, el envío de emails corre en un **segundo servicio** del mismo proyecto
(detalles y variables en [EMAIL.md](EMAIL.md)).

1. En la API, agregar `EMAIL_WORKER=off` y `EMAIL_IMMEDIATE=off`.
2. Crear otro servicio desde el mismo repositorio, con **Root Directory** = `backend`, y en sus *Settings* indicar como
   archivo de configuración `backend/railway.worker.json` (inicia `node src/worker.js`, sin chequeo de salud web ni migraciones).
3. Darle **las mismas variables** que a la API (referencias entre servicios, o *Shared Variables*): usa la misma base, el mismo
   `JWT_SECRET` (firma los links de descarga) y el SMTP. No necesita volumen ni dominio.
4. Ajustar `EMAIL_RATE_PER_SEC` al límite del plan del proveedor de emails.

El worker no corre migraciones: se aplican en el deploy de la API (si faltan, el worker no arranca y lo dice en el log).
Mientras no exista el servicio aparte, la API manda los emails ella misma (es lo que pasa en desarrollo y en el entorno de pruebas).

## 2. Netlify: el sitio

1. *Add new site → Import from Git*, con el mismo repositorio. Netlify toma `frontend/netlify.toml` (build, carpeta de salida, redirección para las rutas de React y cabeceras de seguridad).
2. Variables del sitio:
   - `REACT_APP_API_URL` = URL pública de la API (con `https://`, sin barra final)
   - `REACT_APP_TURNSTILE_SITEKEY` = clave pública de Turnstile
3. Rama de producción: `main`. Cada merge a `main` publica solo.

Las variables `REACT_APP_*` se incorporan al compilar: si se cambian, hay que volver a desplegar el sitio.

## 3. Dominio y HTTPS

1. En Netlify, *Domain management → Add a domain* con `sorteos.cliente.com.ar`, y crear en el DNS del cliente el registro CNAME que indica Netlify.
2. En Railway, *Networking → Custom Domain* con `api.cliente.com.ar`, y crear el CNAME que indica Railway.
3. Ambos emiten el certificado HTTPS solos (puede demorar unos minutos tras propagar el DNS).
4. Actualizar `FRONTEND_URL` y `PUBLIC_API_URL` en Railway y `REACT_APP_API_URL` en Netlify con los dominios finales, y redesplegar los dos.

## 4. Mercado Pago

1. En *Tus integraciones → Webhooks* cargar la URL `https://api.cliente.com.ar/api/webhooks/mercadopago` y activar los eventos de **Pagos**.
2. Copiar la **clave secreta** a `MP_WEBHOOK_SECRET`.
3. En pruebas, usar las credenciales y usuarios de prueba; para producción, reemplazar `MP_ACCESS_TOKEN` por la de producción y quitar `ALLOW_MP_TEST`.

## 5. Primer arranque

1. Abrir `https://api.cliente.com.ar/api/health`: debe responder `{"ok":true}`.
2. Entrar a `/admin` con el email y la contraseña del administrador.
3. Crear el sorteo, los packs y los cursos (con sus PDF) desde el panel.
4. **No** correr `npm run seed` en producción: es solo para desarrollo.

## Lista de control antes de abrir las ventas

- [ ] Compra de punta a punta con una cuenta de prueba: pago aprobado, números asignados y email recibido
- [ ] El email llega a la bandeja de entrada (no a spam) y el link de descarga del curso funciona (SPF, DKIM y DMARC en PASS: ver [EMAIL.md](EMAIL.md))
- [ ] Un pago rechazado y uno pendiente se ven bien en el panel
- [ ] Participación gratuita: llega el email de confirmación y se asigna el número
- [ ] Un reintegro desde Mercado Pago anula la compra en el panel
- [ ] El botón "Consultar" del sorteo responde sin errores
- [ ] El panel muestra "Conexión con Mercado Pago: OK" y el email de alerta llega (probar con una credencial equivocada en el entorno de pruebas)
- [ ] Cambiar el deploy a credenciales de **producción** de Mercado Pago, quitar `ALLOW_MP_TEST`, y hacer una compra real de monto mínimo
- [ ] Backup de la base verificado (ver abajo) y volumen de PDF montado

## Respaldos

Los datos que importan son la **base de datos** (compras, números, pagos) y los **PDF** del volumen.

- Revisar en Railway qué respaldos automáticos incluye el plan contratado, y activarlos.
- Copia manual de la base (conviene antes de cada sorteo):

```bash
pg_dump "$DATABASE_URL" --format=custom --file=respaldo-$(date +%F).dump
```

Guardar la copia fuera del repositorio y fuera de GitHub: contiene datos personales de los compradores.

## Actualizar y volver atrás

- **Actualizar:** merge a `main`. Railway y Netlify despliegan solos; las migraciones corren antes de activar la nueva versión de la API.
- **Volver atrás:** en Railway, *Deployments → Redeploy* de la versión anterior; en Netlify, *Deploys → Publish deploy* de la anterior. Las migraciones solo agregan, por lo que la versión anterior del código sigue funcionando con la base ya migrada. Deshacer una migración (`npm run migrate:undo`) solo se hace a propósito y con un respaldo hecho.
