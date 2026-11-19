# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added
- **Imagen destacada en la portada**: variable opcional `REACT_APP_BRAND_HERO_URL` que muestra una imagen (logo o foto) debajo del título. Sin la variable, la portada queda igual (#62).

### Changed
- **Elección de curso en lista desplegable**: la página de compra ya no muestra todos los cursos como tarjetas; ahora se elige de una lista que se despliega hacia abajo (con scroll), así queda prolija con muchos cursos (#52).
- **Checkout con la API de Orders de Mercado Pago** (`POST /v1/orders`): reemplaza a la API de Preferences, que Mercado Pago marca como heredada y a la que ya no suma funciones. El aviso de pago es ahora el evento **Order** del panel de Webhooks; el servidor traduce el estado de la orden (acreditada, reintegrada, contracargo, rechazada) al que ya usaba, así que números, mails y anulaciones se comportan igual. Las compras anteriores (id de pago numérico) y los avisos de pagos se siguen entendiendo, y `MP_API=preferences` vuelve a la API anterior sin cambiar código. Requiere validar una compra de prueba en el sandbox (#16) (#48).

### Fixed
- **Redes duplicadas en la portada**: se quitó la tarjeta intermedia "Seguí los sorteos en vivo" y la fila del pie de página; las redes quedan debajo del bloque de sorteos (justo bajo el botón "Ver nuestras redes") y arriba a la derecha; en el celular, solo la fila de abajo (#64, #66).
- **Guía de despliegue**: el servicio de mails también debe configurarse a mano en Railway (no aplica `railway.worker.json`), y los respaldos ahora tienen paso a paso: copias automáticas, un script de copia propia (`scripts/respaldo.sh`), cómo restaurar y cómo probar que sirven (#58).
- **Nombres de PDF con tildes**: al subir un curso con un archivo como "Cómo empezar.pdf" el nombre se guardaba roto ("CÃ³mo") y se veía así en el panel y en la descarga. Ahora se guarda bien y los cursos ya cargados se leen corregidos (#54).
- **Despliegue en Railway**: la guía decía que Railway toma `backend/railway.json`, pero no lo aplica en servicios nuevos. Ahora indica cargar el Pre-deploy Command `npm run migrate` en *Settings → Deploy* y se corrige el nombre del remitente de ejemplo a "Zona Norte Automotores" (#50).

### Added
- **Marca del cliente por variables de Netlify**: nombre, textos, color principal, redes y logo se pueden cargar con variables `REACT_APP_BRAND_*`, sin tocar el código ni subir datos del cliente al repositorio (#60).
- **Control contra credenciales de prueba en producción**: las credenciales de prueba de Mercado Pago empiezan con `APP_USR-` igual que las reales, y el control de arranque solo reconocía `TEST-`. Ahora, al crear el checkout, si Mercado Pago devuelve una orden de prueba y `ALLOW_MP_TEST` no está en `true`, la compra se rechaza antes de mandar al comprador a pagar (#56).
- **Email por API de Resend** (`RESEND_API_KEY`): los mails salen por HTTPS y funcionan en cualquier plan de hosting (Railway bloquea el SMTP fuera del plan Pro). El SMTP queda como alternativa; un 429 o 5xx del proveedor hace que la cola reintente (#46).
- **Mis compras con DNI**: el comprador ve sus números ingresando solo el DNI, sin contraseña ni mail (compras acreditadas y participación gratuita confirmada). Muestra el nombre abreviado; descargar el curso pide además el email de la compra. Límite por IP y por DNI, captcha y respuestas iguales exista o no el DNI (#44).
- Provincias excluidas por sorteo (#42): al comprar y al participar gratis se pide la provincia (las 24 jurisdicciones) y quien está en una provincia excluida no puede hacerlo, con un mensaje claro y sin dejar rastro en la base. Por defecto quedan excluidas Mendoza, Formosa, Jujuy, Neuquén, Salta, Río Negro y Tierra del Fuego, que tienen reglas propias para sorteos promocionales, hasta que el abogado del cliente resuelva el trámite de cada una. Se edita desde el panel, y la página pública y las bases informan dónde no está disponible.
- Requisitos legales antes de vender (#42): no se puede abrir (ni reabrir) la venta sin N° de autorización y sin bases y condiciones cargadas. El panel tiene una sección "Requisitos legales y provincias" para cargarlos, y el botón de publicar se deshabilita con el motivo.
- Aviso en la compra y en las bases: "Esta compra se realiza en [lugar], lugar habilitado para este sorteo (autorización N° …)". Se muestra si el organizador completa `location` en `frontend/src/brand.js`; el texto lo tiene que confirmar el abogado del cliente.
- `docs/LEGAL.md`: qué revisar antes de vender (reglas nacionales, provincias con régimen propio, lo que no se pudo confirmar, lista para el abogado) y un borrador de bases con campos para completar.
- Migración `20260701000000-provincias-y-requisitos-legales`: agrega columnas, no modifica datos existentes.

## [0.4.0] - 2026-11-18

Base lista para producción: migraciones, alertas, envío de emails y exportación que escalan, y guía de deploy.

### Added
- Migraciones de base de datos con `sequelize-cli` (#13): esquema inicial (v0.2.0) y migración del Sprint 2, para actualizar una base con datos sin perderlos. Comandos `npm run migrate`, `migrate:status`, `migrate:undo` y `seed` (sorteo demo de desarrollo). Un test compara el esquema de las migraciones con el de los modelos, prueba migrar con datos existentes y deshacer cada migración.
- Alerta de conexión con Mercado Pago (#15): el servidor verifica las credenciales cada 5 minutos con una llamada autenticada; si falla dos veces seguidas la marca como caída, avisa por email al administrador (o a `ALERT_EMAILS`), recuerda cada 6 horas y avisa al recuperarse. El panel muestra "Conexión con Mercado Pago: OK / CAÍDA" con el motivo y un botón "Verificar ahora".
- Envío de emails para alto volumen (#22): el worker toma los pendientes por lotes, con envíos en paralelo, conexiones SMTP reutilizadas y un límite de mails por segundo configurable (`EMAIL_RATE_PER_SEC`). Puede correr como servicio aparte (`npm run worker`) para que un pico de compras no afecte al sitio; con cola larga, el envío inmediato se deja para el worker. Ningún mail se envía dos veces.
- Botón "Reenviar todos los fallidos" en el panel, con el aviso de cuántos emails fallaron y cuántos están en cola.
- Guía `docs/EMAIL.md`: cómo funciona el envío, autenticación del dominio (SPF, DKIM, DMARC), calentamiento del dominio y qué vigilar.
- Exportación del listado completo en streaming (#34): se lee la base por tandas (`EXPORT_BATCH_SIZE`, 2.000 por defecto) con paginación por cursor y cada tanda se escribe a medida que está lista, así la memoria del servidor no crece con el tamaño del sorteo (200.000 compras: +12 MB). Sigue siendo un solo archivo con compras, anuladas y participaciones gratuitas, con las fórmulas neutralizadas. Si el cliente corta la descarga se deja de leer; si falla a mitad, se corta la conexión en vez de entregar un archivo truncado que parezca completo.
- Preparación del deploy (parte de #14; el deploy real queda pendiente de las cuentas y datos del cliente): guía `docs/DEPLOY.md`, configuración para Railway (`backend/railway.json` y `backend/railway.worker.json`: build con Docker, migración antes de cada deploy, chequeo de salud y reinicios) y Netlify (`frontend/netlify.toml`: build, rutas de la app y cabeceras de seguridad).
- Chequeo de configuración al arrancar en producción: la API no inicia si falta una variable importante o si quedan valores de ejemplo, y lista todo lo que falta.

### Changed
- Con PostgreSQL la API ya no usa `sync()`: no arranca si faltan migraciones y avisa cuál correr. Sin `DATABASE_URL` (SQLite) sigue creando el esquema sola.
- `GET /api/health` verifica la conexión a la base y responde 503 si falla.
- `docker compose` aplica las migraciones antes de iniciar la API.

### Fixed
- El registro de auditoría podía no mostrar la última acción si se leía de inmediato (se escribe después de enviar la respuesta); ahora la lectura espera las escrituras en curso.
- `.env.example`: un comentario de Turnstile había quedado mezclado con otra variable; se agregó la clave pública de Turnstile al del frontend.

## [0.3.0] - 2026-11-18

Participación gratuita, control de ventas y sorteo en vivo verificable.

### Added
- Participación gratuita "sin obligación de compra" (#9): formulario con nombre, DNI y email, 1 número por DNI y por sorteo, asignado recién al confirmar el email. Captcha Cloudflare Turnstile y límites por IP (configurable) y por dispositivo, de los que solo se guarda un hash. Panel con contador, listado, anulación y activación por sorteo. Aviso de la modalidad en la compra, el inicio y las bases.
- Reintegros y contracargos (#10): el webhook procesa `refunded` y `charged_back`; la compra queda anulada y sus números pasan a "anulado" con fecha y motivo, sin reutilizarse. Historial de estados de cada compra (`OrderEvent`), contador de anuladas y aviso si se anula el número ya sorteado.
- Buscador del panel (#11): por número exacto, DNI, email o nombre, con la ficha de cada compra (número de operación de Mercado Pago, estado, números e historial). La exportación a Excel es ahora el listado completo del sorteo, con anuladas y participaciones gratuitas.
- Fecha de cierre de ventas (#28): al llegar no se compran más chances ni se suman participaciones gratuitas; las compras iniciadas antes y acreditadas después se respetan. Botones "Habilitar venta" y "Deshabilitar venta". El ganador solo se carga con la venta cerrada.
- Botón "Consultar" antes del sorteo: pregunta a Mercado Pago por las compras sin pago registrado, carga las que faltaban y resume pagos en proceso, compras a revisar y chances válidas.
- Sorteo en vivo (#12): pantalla completa para la transmisión. El servidor elige al azar (`crypto.randomInt`) solo entre los números válidos; en pantalla se ve el número y el nombre abreviado del ganador.
- Cada sorteo queda registrado con fecha, hora, usuario, cantidad de números válidos y posición elegida. Repetir exige un motivo y conserva el historial.
- Al cargar el ganador se verifica su pago en Mercado Pago: si fue reintegrado o tiene contracargo se anula en el acto, se registra el descarte y se vuelve a sortear.
- Registro de auditoría de las acciones de los administradores, sin datos personales ni contraseñas, de solo lectura.

### Changed
- Las participaciones gratuitas y las compras anuladas no cuentan como chances vendidas ni recaudación.
- Un sorteo ya sorteado no se puede reabrir.
- El CSV neutraliza celdas que empiezan con `=`, `+` o `@`.
- Cargar el ganador usa una actualización condicional: dos administradores no se pisan.

## [0.2.0] - 2026-11-18

El comprador elige un curso y un pack de chances; los números se asignan solos al confirmarse el pago.

### Added
- Cursos digitales: modelo, ABM en el panel y subida de PDF (#3).
- Almacenamiento de archivos con interfaz intercambiable (disco local hoy, S3/R2 a futuro).
- Descarga de cursos con links firmados que vencen (`DOWNLOAD_LINK_HOURS`).
- Validación del PDF por contenido (magic bytes) y límite de tamaño (`MAX_PDF_MB`).
- Packs de chances configurables por sorteo, con "El más elegido" y orden (#4).
- Oferta "Duplicá tus chances": activa/inactiva, precio por chance extra y packs donde aparece.
- Cotización en el backend (`POST /api/raffles/:id/quote`), calculada en centavos enteros.
- Escalera de packs sugerida al crear un sorteo.
- Compra de curso + pack (`POST /api/raffles/:id/purchases`) (#5).
- Números consecutivos desde 100000 por sorteo, asignados cuando Mercado Pago confirma el pago, sin duplicados aunque los pagos lleguen a la vez.
- Los números anulados no se reutilizan.
- Job de CI que corre la suite contra PostgreSQL, incluidos los tests de concurrencia.

- Nueva página de compra mobile first: curso + pack + "Duplicá", con precio por chance, ahorro real y barra de progreso (#6).
- Pantalla de confirmación con los números asignados.
- Venta manual por cantidad de chances, con asignación de números en el acto.
- Meta de chances opcional por sorteo para la barra de progreso.
- Email de confirmación con los números, el link de descarga del curso, el monto y el código de compra (#7).
- Envío con patrón outbox: reintentos con espera creciente y estado del envío en cada compra.
- Reenvío del email desde el panel, opcionalmente a una dirección corregida.
- Botón "Descargar el curso" en la página de la compra, que genera un link nuevo cada vez.
- Página "Mis compras" con acceso por link mágico: el comprador pone su email, recibe un link que vence en 30 minutos y ve sus números, comprobantes y cursos (#8).
- `POST /api/my-purchases/link` y `GET /api/my-purchases`, con respuesta idéntica exista o no el email, límite por IP y por email, y token de propósito único.

### Changed
- Un curso con compras no se puede eliminar: se desactiva.
- Las compras admiten medios de pago en efectivo, porque no hay reserva que pueda vencer.
- El número ganador se busca entre las chances asignadas; un número anulado no puede ganar.

### Removed
- Grilla de números, reserva de 15 minutos y promos por cantidad del Sprint 0 (`POST /api/orders`, `GET /api/raffles/:id/numbers`).

## [0.1.0] - 2026-11-18

### Added
- API REST de sorteos, números y órdenes con Express, Sequelize y PostgreSQL.
- Reserva de números con bloqueo de filas y vencimiento automático.
- Integración con Mercado Pago Checkout Pro y webhook con validación de firma.
- Promos por cantidad con cálculo del precio óptimo.
- Panel de administración con JWT: sorteos, estadísticas, venta manual, ganador y exportación CSV.
- Frontend React: landing, grilla de números, selección guiada por promo, estado de compra y página de links.
- Modo demo con API simulada.
- Tests de integración y CI con GitHub Actions.
