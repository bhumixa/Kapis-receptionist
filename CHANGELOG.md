# Changelog

All notable changes to this project are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/) as defined in IMPLEMENTATION_ROADMAP.md Section 2.8 (platform release version, distinct from the API's own `/api/v1` URI versioning).

## [Unreleased] — Milestone 4: Salon Management

Full technical reference: [docs/SALON_ARCHITECTURE.md](docs/SALON_ARCHITECTURE.md), decision record: [docs/adr/ADR-007-salon-management.md](docs/adr/ADR-007-salon-management.md). Scope: the salon's own business profile, branding, business hours, and holiday management only — a narrower, differently-shaped charter than IMPLEMENTATION_ROADMAP.md's original "Salon Management" milestone, which bundled Employees/Services/Customers/Files; that catalog-data scope moves to a new, renumbered Milestone 5. Employees, Customers, Services, Scheduling, WhatsApp, AI, Billing, and Analytics remain explicitly out of scope.

### Added
- **Backend** (`Salon` module, new): `GET/PATCH /salon` (composed salon profile — business/contact info, description, currency, branding — merged with `Tenant`'s existing identity fields via `TenantService`, never duplicated); `GET/PUT /salon/business-hours` (always the full 7-day week, auto-defaulted to closed for missing days); `GET/POST/PATCH/DELETE /salon/holidays[/:id]` (tenant-wide closures, full CRUD).
- **Database**: new `SalonProfile` (1:1 satellite table on `Tenant`, mirroring `TenantSettings`' precedent), `BusinessHours`, and `Holiday` models — field names/shapes match `PRISMA_SCHEMA.md`'s already-reserved, broader Employee/Branch-aware design, so a future milestone's migration only adds columns. No composite-FK cross-tenant pattern needed yet — all three tables reference `Tenant` directly.
- **RBAC**: new `salon:manage` permission, granted to `OWNER`/`MANAGER`; reads are `STAFF`-broad (role-gated only), matching `GET/PATCH /tenant`'s existing read/write split.
- **Frontend**: `salon` feature — `SalonProfilePage` (`/app/salon`), `BusinessHoursPage` (`/app/salon/business-hours`, a 7-row weekly editor), `HolidaysPage` (`/app/salon/holidays`, inline add/edit/delete, no modal needed); `SalonApiService`; a "Salon" nav link in `DashboardLayout`. `ApiClient` gained a `put<T>()` method (its first consumer).
- **Testing**: 20 new backend unit tests (`SalonProfileService`, `BusinessHoursService`, `HolidayService`); 16 new backend integration tests (`test/integration/salon/`) covering cross-tenant isolation, role/permission enforcement, `TENANT_SUSPENDED` behavior, and CRUD validation for all three sub-resources — full existing regression suite (124 unit + 79 integration tests) re-verified green.
- **Documentation**: new `docs/SALON_ARCHITECTURE.md`, `docs/adr/ADR-007-salon-management.md`; `docs/API_SPECIFICATION.md` (new Section 6a); `docs/DATABASE_DESIGN.md` (new `salon_profiles`/`business_hours` sections, `holidays` amended); `docs/IMPLEMENTATION_ROADMAP.md` re-scoped and renumbered (eleven milestones, 19 sprints); amendment notes added to `docs/TENANT_ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/adr/ADR-002`, `docs/adr/ADR-006`.

### Changed
- `TenantRepositoryPort.updateProfile` and `AuditLogService.record` both gained an optional trailing `tx?: Prisma.TransactionClient` parameter (every existing call site is unaffected) — lets `PATCH /salon` compose a Tenant-field write with a SalonProfile-field write in one atomic transaction.
- `modules/auth`'s `TenantResponseDto.logoUrl` comment updated to note it's superseded by `GET /salon`'s own `logoUrl` — still `null`, unchanged behavior.

### Known Limitations
- Logo upload is a placeholder `logoUrl` string field — no `Files`/S3 module exists yet; real upload/storage integration is deferred to the renumbered Milestone 5.
- `Holiday` is tenant-wide only (no `employeeId`) — the eventual per-employee variant requires a manual partial-unique-index migration (documented forward note in `docs/SALON_ARCHITECTURE.md`), not a naive column addition.
- The composite-FK cross-tenant relation pattern remains dormant — none of this milestone's tables reference another tenant-owned entity; it becomes load-bearing starting the renumbered Milestone 5's `Employee`↔`Service` relation.

## [Unreleased] — Milestone 3: Multi-Tenant SaaS Engine

Full technical reference: [docs/TENANT_ARCHITECTURE.md](docs/TENANT_ARCHITECTURE.md), decision record: [docs/adr/ADR-006-multi-tenant-saas-engine.md](docs/adr/ADR-006-multi-tenant-saas-engine.md). Scope: tenant infrastructure only — salon management, scheduling, WhatsApp, AI, and billing are explicitly out of scope.

### Added
- **Backend** (`Tenants` module, new): `GET/PATCH /tenant` (profile), `GET/PATCH /tenant/settings` (five namespaced JSON blocks — `general`/`localization`/`business`/`notifications`/`security` — structured for future expansion, no concrete fields yet), `POST/GET/DELETE /tenant/invitations*` (create/list/revoke staff invitations, deliberately kept under `/tenant/invitations` rather than `/users`).
- **Backend** (`Admin` module, new): `GET /admin/tenants`, `POST /admin/tenants/:id/{suspend,reactivate}` — a deliberately narrow slice of the eventual full console.
- **Backend** (`Auth` module): `POST /auth/accept-invitation` (closes the staff-onboarding loop); `POST /auth/register` now atomically creates `TenantSettings` alongside `Tenant`+`Owner`; `GET /auth/me` gained `activeTenantId` (the *resolved* tenant context, distinct from the JWT's own claim for an impersonating Super Admin).
- **Backend** (`Core` module): `TenantMiddleware` (global, decision-free header extraction) + a reworked `TenantContextService` — now the platform's sole authoritative tenant-context resolver, handling JWT-claim resolution, Super Admin impersonation, tenant-existence validation, and audit logging in one place; `TenantActiveGuard` (`402 TENANT_SUSPENDED` skeleton); `TenantScopedRepository` base class (the tenant-scoped repository pattern every future domain module extends); `AuditLogService`/`AuditLogModule` — a real, persisted, **platform-wide** audit trail pulled forward from Milestone 9.
- **Security:** Platform Admin tenant switching via `X-Impersonate-Tenant-Id`, honored only for `SUPER_ADMIN` and spoofing-protected (zero effect) for every other role; every resolution recorded as a `SUPER_ADMIN_TENANT_SWITCH` audit event. `TenantScopedGuard` now delegates entirely to `TenantContextService` — a `SUPER_ADMIN` with no impersonation header now fails it, a deliberate behavior change from the prior sprint.
- **Frontend:** `TenantApiService`, `AdminApiService`; `tenantImpersonationInterceptor`; `tenantActiveGuard`; `SettingsPage` (`/app/settings` — profile, namespaced settings, team invitations); `AdminTenantsPage` + `AdminLayout` (`/admin/tenants` — tenant list, act-as/suspend/reactivate); `AcceptInvitationPage` (`/auth/accept-invitation/:token`); `TenantSuspendedPage` (`/app/tenant-suspended`, `tenantActiveGuard`'s interim redirect target pending Milestone 8's `/app/billing`); `DashboardLayout` gained tenant-aware nav and an "Acting as X" impersonation banner.
- **Testing:** backend unit tests (`TenantContextService` impersonation/spoofing/memoization, `TenantLifecycleService` transition rules, reworked `TenantScopedGuard`); backend integration tests (`test/integration/tenants/`, `test/integration/admin/`) covering cross-tenant isolation, impersonation, spoofing protection, and the full invitation-create-to-accept flow — a permanent, standing regression suite; frontend unit test fixtures updated for the new `activeTenantId` field; a full manual browser walkthrough (Playwright) of registration → settings → invitation → impersonation → suspend/reactivate.

### Changed
- `TenantScopedGuard`'s behavior: a `SUPER_ADMIN` with no impersonation header now fails with `403 INVALID_TENANT_CONTEXT` rather than passing unconditionally.
- `ResponseTransformInterceptor` gained a `paginated()` escape hatch so list endpoints (starting with `GET /admin/tenants`) can return real `meta.pagination` instead of it being silently discarded.
- `@CurrentTenant()` decorator removed (superseded — see docs/adr/ADR-006).

### Known Limitations
- `TenantFeature`, `Subscription`-linked tenant lifecycle, and `TenantStatus.CANCELLED` are not built (no requested consumer; tied to Billing, Milestone 8).
- `Users`/`UserRole` staff-CRUD (list-all/patch-role/deactivate/last-owner-protection) remains unbuilt — only invitation create/list/revoke/accept exist.
- `GET /admin/users`, `GET /admin/system` remain design-only (Milestone 9 scope).
- The composite-FK cross-tenant relation pattern is documented as the mandatory Milestone-4-onward convention but not yet exercised — no cross-tenant-owned-entity relation exists in this milestone's scope.
- `AuditLog.id` uses standard `gen_random_uuid()`, not the app-generated UUIDv7 PRISMA_SCHEMA.md recommends for this table at scale — deferred until real volume justifies the dependency.

## [Unreleased] — Milestone 3: Authorization (Sprint 2.4 — RBAC)

Full technical reference: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) Section 6b, [docs/SECURITY.md](docs/SECURITY.md), decision record: [docs/adr/ADR-005-rbac.md](docs/adr/ADR-005-rbac.md). IMPLEMENTATION_ROADMAP.md calls this slot "Sprint 3.1"; this release implements a narrower, RBAC-only charter — see the ADR.

### Added
- **Backend** (`Core` module, previously empty): `PermissionResolverService` (resolves a user's effective permission set as the union across all held roles, Redis-cached per role — `rbac:role-permissions:{RoleName}`, TTL `RBAC_PERMISSION_CACHE_TTL_SECONDS`); four guards — `RolesGuard`, `PermissionGuard`, `TenantScopedGuard`, `SuperAdminGuard` — all composing on the existing `JwtAuthGuard`; `@Roles()`, `@RequirePermission()`, `@CurrentTenant()` decorators; request-scoped `TenantContextService`; a guard-layer role-rank interpretation (`SUPER_ADMIN` > `OWNER` > `MANAGER` > `STAFF`) for "role hierarchy," leaving the underlying flat `Role`/`Permission`/`RolePermission` schema unchanged.
- **Security:** an explicit, logged `SUPER_ADMIN` bypass on `RolesGuard`/`PermissionGuard` (`SuperAdminBypassService`, new `SUPER_ADMIN_BYPASS` `SecurityEventService` event type) — a deliberate, requester-confirmed deviation from SYSTEM_ARCHITECTURE.md Section 8.4's original design; see the ADR for full reasoning and mitigations.
- **Frontend:** `PermissionService.can(permission): Signal<boolean>`, `roleGuard` (route-level, reads `data.roles`), `*appHasPermission` structural directive (hide-only), `filterNavItemsByAccess()` nav-filtering utility — all deliberate, documented mirrors of the backend's rank/permission logic (no shared types package exists).
- **Testing:** new backend unit tests for the permission resolver, role-rank truth table, all four guards, and the bypass service; a test-only `RbacProbeController`/`RbacProbeModule` (mounted only by the integration test bootstrap, never production) proving the guards over real HTTP; a full authorization matrix integration test (every role × every guarded probe route) doubling as a regression guard on `prisma/seed.ts`'s permission matrix; dedicated `TenantScopedGuard` and `SUPER_ADMIN` bypass-logging integration tests; new `seedManager`/`seedStaff`/`seedSuperAdmin` helpers in `test-app.factory.ts`; new frontend unit tests for `PermissionService`, `roleGuard`, `HasPermissionDirective`, and both rank/nav-filter utilities.
- **Documentation:** new `docs/SECURITY.md`; new `docs/adr/ADR-005-rbac.md`; `docs/AUTHENTICATION.md` Section 6b; `docs/API_SPECIFICATION.md` Section 2.14 amended (SUPER_ADMIN bypass) and Section 2.14.1 added (RBAC error semantics); `docs/IMPLEMENTATION_ROADMAP.md` execution note under Sprint 3.1; `docs/DECISIONS.md` ADR-005 entry.

### Known Limitations
- The full `Tenants` business module (`TenantSettings`, `TenantFeature`), the composite-FK cross-tenant relation pattern, and the standing tenant-isolation regression suite (roadmap Sprint 3.1's broader scope) remain open.
- `TenantScopedGuard`'s per-resource-ID ownership check is a documented open item — no tenant-owned business resource exists yet to check against.
- `TenantActiveGuard` (frontend and backend) is not built this sprint.
- No `Users`/`UserRole` CRUD or role-assignment endpoint exists — role changes after registration aren't possible yet, and the resulting session/JWT-invalidation question is a documented open gap.
- Google OAuth, MFA/WebAuthn, and a CSRF double-submit token on `/auth/refresh` remain out of scope (unchanged from prior sprints).

## [Unreleased] — Milestone 2: Authentication (Sprint 2.3 — Account Security)

Full technical reference: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) Section 6a, decision record: [docs/adr/ADR-004-account-security.md](docs/adr/ADR-004-account-security.md).

### Added
- **Backend** (`Auth` module): `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- **Notifications**: new minimal `Notifications` module (`NotificationsService.sendEmail`) — `nodemailer` over SMTP with a log-only fallback when `SMTP_HOST` is unset, keeping local dev/CI working with zero mail infrastructure.
- **Security**: email verification (required to log in — `403 EMAIL_NOT_VERIFIED` now enforced) and password reset, both via single-use, SHA-256-hashed opaque tokens (`TokenService.generateOpaqueToken`/`hashOpaqueToken`); Redis-backed login-attempt tracking with temporary account lockout (5 failed attempts / 15-minute window → 15-minute lockout, `403 ACCOUNT_LOCKED`, new `LoginAttemptService`), keyed by normalized email to stay enumeration-resistant; password reset revokes every refresh token for the user (`SessionService.revokeAllForUser`, previously only used by reuse-detection); `SecurityEventService` extended with six new event types.
- **Frontend**: new `verify-email-page`, `forgot-password-page`, `reset-password-page`; `login-page` gained a "Forgot password?" link, inline `EMAIL_NOT_VERIFIED` (with one-click resend) / `ACCOUNT_LOCKED` handling, and its post-register/post-reset banners now correctly reflect that a verification email is sent / that a password reset succeeded.
- **Testing**: new backend unit tests (`LoginAttemptService`, `NotificationsService`, `TokenService`'s opaque-token helpers) and `AuthService` coverage for every new path (verify/resend/forgot/reset, lockout, unverified-login); new integration tests against a real Postgres/Redis for all four new endpoints plus a dedicated lockout spec; existing `login`/`test-app.factory` fixtures updated so pre-existing specs aren't broken by the new `EMAIL_NOT_VERIFIED` enforcement.

### Changed
- `POST /auth/register`'s response `message` reverts to `"Verification email sent."` (the original documented contract) now that an email is genuinely sent — see ADR-003's temporary substitution, now superseded.

### Known Limitations
- Google OAuth, invitation-acceptance, RBAC authorization enforcement, and the `Users`/`Tenants` modules as their own NestJS modules remain explicitly out of scope (unchanged from the Core Authentication sprint) — see ADR-004 for this sprint's precise boundary.
- A CSRF double-submit token on `/auth/refresh` remains deferred, not implemented.

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
