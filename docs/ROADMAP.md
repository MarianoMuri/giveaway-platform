# Roadmap

Sprints de 1 semana. Cada ítem es un issue en GitHub.

## Sprint 0 · Base del sistema — `v0.1.0` ✅

- [x] API REST con Express + Sequelize + PostgreSQL
- [x] Modelos: sorteos, números, órdenes
- [x] Reserva de números con bloqueo (`SELECT … FOR UPDATE`) y vencimiento
- [x] Integración con Mercado Pago Checkout Pro + webhook firmado
- [x] Promos por cantidad con cálculo del precio óptimo
- [x] Panel de administración (JWT): sorteos, ventas, venta manual, ganador, exportación CSV
- [x] Frontend React: landing, grilla de números, selección guiada por promo, estado de compra, página de links
- [x] Modo demo con API simulada en el navegador
- [x] Tests de integración del flujo de compra y de precios
- [x] CI con GitHub Actions

## Sprint 1 · Modelo de productos y participación gratuita — `v0.2.0`

- [ ] Productos (cursos digitales) asociados a un sorteo: cada pack otorga N chances
- [ ] Asignación automática de números al confirmarse el pago
- [ ] Participación gratuita "sin obligación de compra" (registro con DNI, 1 chance por persona)
- [ ] Panel del comprador: ver productos comprados y números asignados
- [ ] ABM de productos y su contenido en el panel de administración
- [ ] Bases y condiciones con la leyenda obligatoria en todas las pantallas de venta

## Sprint 2 · Producción — `v0.3.0`

- [ ] Migraciones con `sequelize-cli` (reemplazar `sync()`)
- [ ] Deploy de la API + PostgreSQL en Railway
- [ ] Deploy del frontend en Netlify con dominio propio y HTTPS
- [ ] Pruebas end-to-end con credenciales y usuarios de prueba de Mercado Pago
- [ ] Logs y alertas básicas de errores

## Sprint 3 · Comunicación y métricas — `v0.4.0`

- [ ] Email al comprador con sus números
- [ ] Recaudación neta en el panel (comisión de Mercado Pago informada por la API)
- [ ] Registro de auditoría del sorteo (quién cargó el ganador y cuándo)
- [ ] Tests del frontend con React Testing Library
