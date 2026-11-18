# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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
