# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added
- Cursos digitales: modelo, ABM en el panel y subida de PDF (#3).
- Almacenamiento de archivos con interfaz intercambiable (disco local hoy, S3/R2 a futuro).
- Descarga de cursos con links firmados que vencen (`DOWNLOAD_LINK_HOURS`).
- Validación del PDF por contenido (magic bytes) y límite de tamaño (`MAX_PDF_MB`).
- Packs de chances configurables por sorteo, con "El más elegido" y orden (#4).
- Oferta "Duplicá tus chances": activa/inactiva, precio por chance extra y packs donde aparece.
- Cotización en el backend (`POST /api/raffles/:id/quote`), calculada en centavos enteros.
- Escalera de packs sugerida al crear un sorteo.

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
