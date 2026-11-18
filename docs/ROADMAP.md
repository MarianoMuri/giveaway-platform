# Roadmap

Sprints de 1 semana. Cada ítem es un issue en GitHub, agrupado en un milestone.

## Sprint 0 · Base del sistema — `v0.1.0` ✅

- [x] API REST con Express + Sequelize + PostgreSQL
- [x] Integración con Mercado Pago Checkout Pro + webhook firmado
- [x] Panel de administración (JWT): sorteos, ventas, venta manual, ganador, exportación CSV
- [x] Frontend React: landing, compra, estado de compra, página de links
- [x] Modo demo con API simulada en el navegador
- [x] CI con GitHub Actions

## Sprint 1 · Cursos y compra de chances — `v0.2.0`

- [x] #3 Cursos con PDF descargable
- [x] #4 Packs de chances configurables y oferta "Duplicá"
- [x] #5 Números consecutivos asignados al confirmarse el pago
- [x] #6 Nueva página de compra: curso + pack (reemplaza la grilla de números del Sprint 0)
- [x] #7 Email de confirmación con números y descarga del curso
- [x] #8 Página "Mis compras" con acceso por link mágico

## Sprint 2 · Participación gratuita, control y sorteo — `v0.3.0`

- [ ] #9 Participación gratuita "sin obligación de compra"
- [ ] #10 Contracargos y devoluciones anulan los números
- [ ] #11 Buscador de números y participantes en el panel
- [ ] #12 Sorteo en vivo con registro de auditoría

## Sprint 3 · Producción — `v1.0.0`

- [ ] #13 Migraciones de base de datos con `sequelize-cli`
- [ ] #14 Deploy en Railway y Netlify con dominio propio
- [ ] #15 Alerta de conexión con Mercado Pago en el panel
- [ ] #16 Pruebas end-to-end con credenciales de prueba de Mercado Pago
