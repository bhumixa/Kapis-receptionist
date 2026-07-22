# Changelog

All notable changes to this project are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/) as defined in IMPLEMENTATION_ROADMAP.md Section 2.8 (platform release version, distinct from the API's own `/api/v1` URI versioning).

## [Unreleased] — Milestone 2: Authentication (Core Authentication)

Full technical reference: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md), sequence diagrams: [docs/AUTH_FLOW.md](docs/AUTH_FLOW.md), decision record: [docs/adr/ADR-003-core-authentication.md](docs/adr/ADR-003-core-authentication.md).

### Added
- **Backend** (`Auth` module): `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me` — full Clean Architecture layering (domain ports/entities, application services, Prisma infrastructure, interface controller/DTOs/guard).
- **Security**: Argon2id password hashing (production-tuned parameters, documented); JWT access tokens (15 min, HS256) via a hand-rolled `JwtAuthGuard`; opaque, HMAC-peppered refresh tokens (30 days) in an httpOnly/`SameSite=Strict` cookie scoped to `/api/v1/auth`; refresh-token rotation with reuse detection (an all-device revoke on detected theft, correctly distinguished from a merely-expired post-logout token); rate limiting on the Public-Sensitive/Standard-Authenticated tiers; structured `SecurityEventService` logging for every auth event.
- **Reusable services**: `PasswordService`, `TokenService`, `SessionService`, `SecurityEventService`.
- **Frontend**: `auth` feature (Login, Register pages) with Reactive Forms and client-side validation mirroring the server; `AuthStateService` (signals-based session store), `AuthApiService`, `SessionService` (silent refresh on bootstrap, single-in-flight refresh coordination); `AuthInterceptor`, `AuthGuard`/`GuestOnlyGuard`; minimal `AuthLayout`/`DashboardLayout`.
- **Testing**: 29 backend unit tests (`PasswordService`, `TokenService`, `SessionService`, `AuthService`), 18 backend integration tests against a real Postgres/Redis (all 5 endpoints, including reuse-detection and logout-vs-reuse edge cases), 22 frontend unit tests (`AuthStateService`, guards, `SessionService`, `AuthInterceptor`); a new `test/integration` Jest runner and CI step, since that tier existed as an empty placeholder since Milestone 1 with nothing wired up to run it.

### Fixed
- A refresh-token reuse-detection bug found during this sprint's own manual verification: logging out on one device was incorrectly classified identically to a stolen/replayed rotated token, both setting `revokedAt` — which meant a single logout could spuriously mass-revoke every other active session for that user. Fixed by keying the reuse check off `replacedBySessionId` (only ever set by rotation), not `revokedAt` alone; covered by both a unit test and an integration test so it can't silently regress.

### Known Limitations
- Email verification, password reset, Google OAuth, and RBAC authorization enforcement are explicitly out of scope this sprint (see ADR-003) — every authenticated user, regardless of role, can currently reach every authenticated endpoint.
- `Users`/`Tenants` as their own NestJS modules (staff CRUD, invitations, `TenantSettings`, atomic tenant-provisioning transaction) remain Milestone 3 scope; this sprint's `User`/`Tenant` data access lives inside `AuthModule`'s own infrastructure layer.
- A CSRF double-submit token on `/auth/refresh` (documented defense-in-depth beyond the implemented `SameSite=Strict`/`HttpOnly` cookie) is deferred, not implemented.

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
