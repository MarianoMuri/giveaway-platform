# Cómo se trabaja en este repo

## Ramas

| Rama | Para qué |
|---|---|
| `main` | Producción. Solo recibe merges desde `develop` al cerrar un sprint (con tag de versión). |
| `develop` | Integración. Acá se mergean las funcionalidades terminadas. |
| `feature/<issue>-<descripcion>` | Una funcionalidad. Ej: `feature/12-participacion-gratuita` |
| `fix/<issue>-<descripcion>` | Corrección de un bug. Ej: `fix/21-webhook-monto-distinto` |

Flujo:

```bash
git checkout develop && git pull
git checkout -b feature/12-participacion-gratuita
# ...commits...
git push -u origin feature/12-participacion-gratuita
# abrir Pull Request hacia develop, con "Closes #12" en la descripción
```

## Commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/):

```
<tipo>(<alcance>): <descripción en presente>
```

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de bug |
| `test` | Tests |
| `docs` | Documentación |
| `refactor` | Cambio interno sin cambiar comportamiento |
| `chore` | Configuración, dependencias, tooling |
| `ci` | Pipelines |

Ejemplos: `feat(api): add pack quote endpoint`, `fix(web): refresh order status after payment`.

## Sprints

- Duración: 1 semana.
- Cada sprint es un **Milestone** en GitHub; cada tarea es un **Issue** asignado a ese milestone.
- El tablero (GitHub Projects) tiene las columnas: `Backlog` → `To do` → `In progress` → `In review` → `Done`.
- Al cerrar el sprint: merge `develop` → `main`, tag (`v0.2.0`, …) y entrada en `CHANGELOG.md`.

El plan está en [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Antes de abrir un PR

```bash
cd backend && npm test
cd frontend && CI=true npm run build
```

`npm test` usa SQLite en memoria y saltea los tests de concurrencia, porque SQLite no admite transacciones en paralelo. Para correr la suite completa contra PostgreSQL, como hace el CI:

```bash
# Postgres descartable solo para tests: los tests borran y recrean las tablas
docker run --rm -d --name pg-test -p 5433:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test postgres:16-alpine
cd backend && DATABASE_URL=postgres://postgres:test@localhost:5433/test npm test
docker stop pg-test
```

Nunca subas archivos `.env`, credenciales de Mercado Pago ni datos de clientes. La marca de cada cliente vive fuera del repo (carpeta `clients/`, ignorada por git).
