# Deploy a producción

Guía para publicar el sistema con **Railway** (API + PostgreSQL), **Cloudflare Pages o Netlify** (sitio) y el dominio del cliente.
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
- [ ] Cuenta de **Resend** con el dominio verificado (SPF y DKIM) y la clave de API (`RESEND_API_KEY`). Plan **Pro** para el lanzamiento (el gratis corta en 100 mails por día)
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
2. Agregar un servicio desde el repositorio de GitHub. En *Settings → Source* poner **Root Directory** = `backend`. El build usa el `Dockerfile` de `backend`. Railway no aplica `backend/railway.json` en los servicios nuevos (la configuración por archivo quedó en desuso), así que el comando de migración y el chequeo de salud se cargan a mano en el paso 5.
3. Crear un **volumen** y montarlo en `/data` (los PDF de los cursos viven ahí; sin volumen se pierden en cada deploy).
4. Cargar las variables del servicio (*Variables*):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` (ya viene en el Dockerfile) |
| `DATABASE_URL` | referencia a la variable de la base: `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | el secreto generado arriba |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | datos del administrador |
| `LIVE_EMAIL` / `LIVE_PASSWORD_HASH` | (opcional) operador del sorteo en vivo: solo puede abrir la pantalla del sorteo y sortear; no ve compradores, recaudación ni cursos. Mismo tipo de hash bcrypt que el administrador |
| `FRONTEND_URL` | URL del sitio, con `https://` y sin barra final |
| `PUBLIC_API_URL` | URL pública de la API, con `https://` |
| `MP_ACCESS_TOKEN` | credencial de Mercado Pago |
| `MP_WEBHOOK_SECRET` | clave secreta del webhook |
| `MP_API` | opcional. `orders` (por defecto) o `preferences` para volver a la API anterior |
| `RESEND_API_KEY` (o `SMTP_URL`) / `MAIL_FROM` / `MAIL_REPLY_TO` | datos del proveedor de emails. Se prefiere la API de Resend porque Railway bloquea el SMTP fuera del plan Pro |
| `EMAIL_RATE_PER_SEC` / `EMAIL_BATCH_SIZE` / `EMAIL_CONCURRENCY` | (opcionales) velocidad del envío de emails, ver [EMAIL.md](EMAIL.md) |
| `ALERT_EMAILS` | (opcional) a quién avisar si se cae la conexión con Mercado Pago, separados por coma; por defecto, `ADMIN_EMAIL` |
| `TURNSTILE_SECRET` | clave secreta de Turnstile |
| `STORAGE_DIR` | `/data/storage` |
| `BRAND_NAME`, `BRAND_COLOR`, `BRAND_LOGO_URL`, `BRAND_WHATSAPP_URL` | marca del cliente en los emails |
| `ALLOW_MP_TEST` | `true` **solo** en el entorno de pruebas con credenciales de prueba |

5. En *Settings → Deploy* cargar **Pre-deploy Command** = `npm run migrate` y, opcionalmente, **Healthcheck Path** = `/api/health`. Sin el Pre-deploy Command la API no arranca: se niega a iniciar si hay migraciones pendientes. Después desplegar. En cada deploy Railway corre `npm run migrate` antes de iniciar la API; si la migración falla, el deploy no se activa y la versión anterior sigue funcionando.
6. En *Settings → Networking* generar el dominio público (o agregar `api.cliente.com.ar`, ver paso 3).

La API **no arranca** si falta alguna variable importante o si hay valores de ejemplo: el log del deploy lista exactamente qué falta.

### Servicio de envío de emails (worker)

Para que un pico de compras no afecte al sitio, el envío de emails corre en un **segundo servicio** del mismo proyecto
(detalles y variables en [EMAIL.md](EMAIL.md)).

1. En la API, agregar `EMAIL_WORKER=off` y `EMAIL_IMMEDIATE=off`.
2. Crear otro servicio desde el mismo repositorio, con **Root Directory** = `backend`. Railway **no aplica** los archivos de configuración del repositorio (`railway.worker.json`) en servicios nuevos, así que en *Settings → Deploy* cargar a mano el **Custom Start Command** = `node src/worker.js`, dejar vacío el Pre-deploy Command y sin Healthcheck Path (el worker no es un servicio web).
3. Darle **las mismas variables** que a la API (referencias entre servicios, o *Shared Variables*): usa la misma base, el mismo
   `JWT_SECRET` (firma los links de descarga) y el proveedor de email. No necesita volumen ni dominio.
4. Ajustar `EMAIL_RATE_PER_SEC` al límite del plan del proveedor de emails.

El worker no corre migraciones: se aplican en el deploy de la API (si faltan, el worker no arranca y lo dice en el log).
Mientras no exista el servicio aparte, la API manda los emails ella misma (es lo que pasa en desarrollo y en el entorno de pruebas).

## 2. Cloudflare Pages (alternativa a Netlify)

Es lo que usa hoy el sitio de pruebas (Netlify pausa las publicaciones si se acaban los créditos del plan gratuito). En *Workers & Pages → Create → Pages → Import an existing Git repository*:

- Rama de producción: `develop` (para el sitio real, `main`).
- Directorio raíz: `frontend`. Comando de build: `npm install && npm run build`. Carpeta de salida: `build`.
- Variables: `NODE_VERSION=22` y las mismas `REACT_APP_*` que se listan en la sección de Netlify.
- Las rutas de React funcionan solas (Pages sirve `index.html` si no existe el archivo) y las cabeceras de seguridad salen de `frontend/public/_headers`.
- Después, en Railway, poner `FRONTEND_URL` con la dirección nueva (la API solo acepta esa) y volver a desplegar.

### Vista previa al compartir (Cloudflare Pages)

El archivo `frontend/functions/_middleware.js` completa título, descripción y foto cuando alguien comparte un link. Usa estas variables del proyecto de Pages (en *Settings → Variables and secrets*, en Producción): `REACT_APP_API_URL` (ya está), `REACT_APP_BRAND_NAME`, `REACT_APP_BRAND_DESCRIPTION` y, si se quiere otra imagen para la portada, `REACT_APP_BRAND_SHARE_IMAGE` (link a una imagen de 1200x630). Sin la imagen usa `frontend/public/share-default.jpg`. WhatsApp guarda la vista previa un tiempo: para probar un link nuevo, agregarle `?v=2` al final. Para forzar a Facebook/Instagram a releerla: https://developers.facebook.com/tools/debug/.

## 2b. Netlify: el sitio

1. *Add new site → Import from Git*, con el mismo repositorio. Netlify toma `frontend/netlify.toml` (build, carpeta de salida, redirección para las rutas de React y cabeceras de seguridad).
2. Variables del sitio:
   - `REACT_APP_API_URL` = URL pública de la API (con `https://`, sin barra final)
   - `REACT_APP_TURNSTILE_SITEKEY` = clave pública de Turnstile
   - Medición (opcional; sin estas variables no se carga nada): `REACT_APP_META_PIXEL_ID` (ID numérico del Pixel de Meta) y/o `REACT_APP_GA_ID` (ID de Google Analytics 4, empieza con `G-`). Solo se activan si la persona acepta el aviso de cookies y nunca reciben datos personales: solo sorteo, monto y chances. Eventos: vista del sorteo, inicio de compra y compra confirmada (una vez por compra).
   - Marca del cliente (todas opcionales; sin ellas queda la marca genérica "AUTO SORTEOS"): `REACT_APP_BRAND_NAME`, `REACT_APP_BRAND_TAGLINE`, `REACT_APP_BRAND_DESCRIPTION`, `REACT_APP_BRAND_PRIMARY` (color, ej. `#e3262f`), `REACT_APP_BRAND_LOGO_URL` (link público al logo), `REACT_APP_BRAND_HERO_URL` (imagen opcional debajo del título de la portada), `REACT_APP_BRAND_INSTAGRAM`, `REACT_APP_BRAND_YOUTUBE`, `REACT_APP_BRAND_FACEBOOK`, `REACT_APP_BRAND_TIKTOK`, `REACT_APP_BRAND_WHATSAPP_CHANNEL`, `REACT_APP_BRAND_WHATSAPP_CONTACT`. Así los datos del cliente quedan en Netlify y no en el repositorio.
3. Rama de producción: `main`. Cada merge a `main` publica solo.

Las variables `REACT_APP_*` se incorporan al compilar: si se cambian, hay que volver a desplegar el sitio.

### Doble verificación del administrador (recomendado antes de abrir las ventas)

1. En tu computadora, en la carpeta `backend`: `node scripts/two-factor-setup.js tu@mail.com`. Muestra una clave (no se guarda en ningún lado).
2. En Railway, servicio de la API → Variables: crear `ADMIN_TOTP_SECRET` con esa clave. Esperar a que termine de publicar.
3. En el celular, en Google Authenticator: "+" → "Ingresar clave de configuración" → pegar la misma clave.
4. Al entrar al panel, después de la contraseña pide el código de 6 números.

Si se pierde el celular: guardando la clave se puede armar la app de nuevo en otro; si no, se borra `ADMIN_TOTP_SECRET` en Railway (el panel vuelve a pedir solo la contraseña) y se repite el proceso. El operador del sorteo en vivo no usa código.

## 3. Dominio y HTTPS

1. En Netlify, *Domain management → Add a domain* con `sorteos.cliente.com.ar`, y crear en el DNS del cliente el registro CNAME que indica Netlify.
2. En Railway, *Networking → Custom Domain* con `api.cliente.com.ar`, y crear el CNAME que indica Railway.
3. Ambos emiten el certificado HTTPS solos (puede demorar unos minutos tras propagar el DNS).
4. Actualizar `FRONTEND_URL` y `PUBLIC_API_URL` en Railway y `REACT_APP_API_URL` en Netlify con los dominios finales, y redesplegar los dos.

## 4. Mercado Pago

1. En *Tus integraciones → Webhooks* cargar la URL `https://api.cliente.com.ar/api/webhooks/mercadopago` y activar el evento **Order (Mercado Pago)** (el checkout usa la API de Orders; si se vuelve a `MP_API=preferences`, activar **Pagos**). Esa es la dirección a la que Mercado Pago avisa cada pago.
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
- [ ] **Respaldos (decisión pendiente):** los automáticos de Railway (pestaña Backups) requieren el plan pago, y por ahora se decidió no pagarlo. Mientras tanto, la protección es la **copia propia** con `backend/scripts/respaldo.sh` (gratis): hacerla **antes de cada sorteo y una vez por semana**. Si más adelante se contrata el plan pago de Railway, activar Backups diarios y semanales

## Respaldos

Los datos que importan son la **base de datos** (compras, números, pagos) y los **PDF** del volumen.

**Automáticos.** En Railway, abrir el servicio de Postgres → pestaña **Backups** y programar copias diarias (y semanales). Revisar qué incluye el plan contratado. Ojo: estas copias viven dentro de Railway, así que no reemplazan a una copia propia.

**Copia propia (recomendado antes de cada sorteo y una vez por semana).** Desde tu computadora, con `pg_dump` instalado y la variable `DATABASE_PUBLIC_URL` del servicio Postgres:

```bash
DATABASE_PUBLIC_URL="postgresql://..." ./scripts/respaldo.sh
```

Guarda un archivo `respaldo-AAAA-MM-DD-HHMM.dump` en `~/respaldos-sorteos`. Esa copia tiene datos personales de los compradores: guardarla fuera del repositorio y de GitHub (por ejemplo, en un disco o una nube privada).

**Restaurar (en una base vacía o de pruebas, nunca encima de la de producción sin un respaldo nuevo):**

```bash
pg_restore --no-owner --clean --if-exists --dbname="$DATABASE_PUBLIC_URL" respaldo-AAAA-MM-DD-HHMM.dump
```

**Probar que el respaldo sirve.** Una copia que nunca se restauró no es una garantía: antes de abrir las ventas, restaurarla en una base de prueba y entrar al panel para ver que las compras estén.

**PDF.** Viven en el volumen del servicio de la API (`STORAGE_DIR`). Conservar también los archivos originales de cada curso fuera de Railway.

## Actualizar y volver atrás

- **Actualizar:** merge a `main`. Railway y Netlify despliegan solos; las migraciones corren antes de activar la nueva versión de la API.
- **Volver atrás:** en Railway, *Deployments → Redeploy* de la versión anterior; en Netlify, *Deploys → Publish deploy* de la anterior. Las migraciones solo agregan, por lo que la versión anterior del código sigue funcionando con la base ya migrada. Deshacer una migración (`npm run migrate:undo`) solo se hace a propósito y con un respaldo hecho.
