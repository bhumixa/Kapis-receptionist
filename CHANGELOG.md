# Changelog

All notable changes to this project are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/) as defined in IMPLEMENTATION_ROADMAP.md Section 2.8 (platform release version, distinct from the API's own `/api/v1` URI versioning).

## [0.1.0] — Milestone 1: Project Foundation

Full release notes: [docs/releases/v0.1.0-foundation.md](docs/releases/v0.1.0-foundation.md)

### Added
- Monorepo structure (`backend/`, `frontend/`, `infrastructure/`, `docs/`, `.github/workflows/`, `scripts/`) per SYSTEM_ARCHITECTURE.md Section 14.
- **Backend** (NestJS 11): environment config with fail-fast bootstrap validation, `PrismaService`/`RedisService` connection wrappers, structured JSON logging (`nestjs-pino`) tagged with a `req_<ULID>` correlation ID, global `ValidationPipe`/`GlobalExceptionFilter`/`ResponseTransformInterceptor` implementing API_SPECIFICATION.md's success/error envelopes, Swagger at `/api/docs`, `/health` and `/health/ready` endpoints.
- **Database**: first Prisma migration (`Role`, `Permission`, `RolePermission`, `Plan` — PRISMA_SCHEMA.md Section 14.2 step 1) and required seed script.
- **Frontend** (Angular 20): Tailwind CSS, `core`/`shared`/`layouts`/`features` structure per FRONTEND_ARCHITECTURE.md Section 2, `ApiClient` (envelope-unwrapping, typed `ApiError`), request-ID interceptor, one placeholder route.
- **Infrastructure**: multi-stage Docker images for both apps, `docker-compose.yml` (postgres, redis, backend, frontend, nginx — all healthcheck-gated), nginx reverse proxy.
- **CI**: GitHub Actions running install → lint → test → build for both apps, with Postgres/Redis service containers for the backend job.
- **Tooling**: Husky + lint-staged (ESLint/Prettier on staged files) and commitlint (Conventional Commits) as pre-commit/commit-msg hooks, per Section 13's Quality Gates.

### Known Limitations
- No automated tests yet beyond the scaffolded default (zero backend unit tests, one trivial frontend smoke test) — Milestone 1 has no business logic to test; real coverage starts with Milestone 2.
- Prisma schema contains only 4 of the ~55 models documented in PRISMA_SCHEMA.md — the rest are added incrementally as each milestone's modules are built.
- No LICENSE file yet (pending a business decision on licensing terms).

[0.1.0]: https://github.com/bhumixa/Kapis-receptionist/releases/tag/v0.1.0
