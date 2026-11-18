# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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
