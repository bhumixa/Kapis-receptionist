# Architecture Decision Records

A running log of significant architectural decisions made during implementation — specifically ones where the code deviated from, extended, or had to choose between options left open by the seven planning documents (PROJECT_REQUIREMENTS.md through IMPLEMENTATION_ROADMAP.md). Per IMPLEMENTATION_ROADMAP.md Section 9, an ADR is added whenever a change constitutes a meaningful architectural deviation — not for every routine implementation choice already fully specified by those documents.

Individual, more detailed ADRs may also live in [docs/adr/](adr/) as the project grows; this file is the lightweight running index/log for now.

---

## ADR-001: Project Foundation

**Status:** Accepted
**Date:** 2026-07-21
**Milestone:** 1 — Project Foundation

### Context

SYSTEM_ARCHITECTURE.md, PRISMA_SCHEMA.md, and FRONTEND_ARCHITECTURE.md were written before any scaffolding existed. Implementing Milestone 1 against real tooling (NestJS 11, Angular 20, Prisma 6/7, Tailwind 3/4) surfaced several points where the documented design had to be made concrete, and a few where the most current tool version conflicted with what the documents assumed.

### Decisions

1. **`src/database/` instead of `src/prisma/`.** SYSTEM_ARCHITECTURE.md Section 14 names the Prisma wrapper folder `src/prisma/`; implementation uses `src/database/` (also housing `RedisService`) to match the explicit folder structure requested when Milestone 1 was resumed. Same responsibility, reconciled name.

2. **Prisma pinned to 6.19.3, not 7.x.** Prisma 7 (released after PRISMA_SCHEMA.md was written) changed the generator/config conventions — mandatory `prisma.config.ts`, mandatory client `output` path, `datasource.url` moved out of `schema.prisma`. These don't match the schema syntax PRISMA_SCHEMA.md documents (`generator client { provider = "prisma-client-js" }`, inline `url = env("DATABASE_URL")`). 6.19.3 is the latest release matching the documented syntax exactly.

3. **Tailwind v3, not v4.** FRONTEND_ARCHITECTURE.md Section 11 documents the design-token mechanism as `tailwind.config.js`'s `theme.extend.colors`/`fontSize`/`boxShadow` referencing CSS custom properties — Tailwind v3's JS-config API. v4's CSS-first `@theme` config doesn't use this mechanism. v3.4.19 keeps the documented mechanism valid for the still-pending Design System document.

4. **Milestone 1's Prisma schema contains only the global-reference-data batch** (`Role`, `Permission`, `RolePermission`, `Plan` — PRISMA_SCHEMA.md Section 14.2, step 1), not the full 55-model schema. This matches the documented incremental migration order; every other model is added in the migration batch of the milestone that introduces it.

5. **`angular-eslint` pinned to `20.7.0`, not `latest` (`21.x`).** `ng add angular-eslint` installs whatever's newest on npm regardless of the host Angular version, and 21.x ships a nested `@angular-devkit/core` requiring `chokidar@^5.0.0` that conflicts with Angular 20's own `chokidar@^4.0.0` — `npm install` silently deduped around it (installing anyway with an "invalid" resolution marker), but `npm ci` correctly refused, breaking every Docker build and CI run. Caught during the pre-first-commit review by testing `docker compose up` from a genuinely fresh clone rather than trusting a working local `node_modules`; `20.7.0` is the latest release actually matching Angular 20's peer range.

6. **Pre-commit tooling (Husky + lint-staged + commitlint) added at the repo root**, even though it wasn't explicitly re-scoped into Milestone 1's later task list. IMPLEMENTATION_ROADMAP.md Section 13's Quality Gates table requires Prettier "as a pre-commit hook **and** a CI check" as a blocking gate, and Section 2.4 requires Conventional Commits — added during the pre-first-commit release review to close this gap rather than defer it past the first commit.

7. **`/health` and `/health/ready` sit outside `/api/v1`** and return their own plain JSON shape rather than API_SPECIFICATION.md's success envelope — they're infrastructure-level (Docker healthchecks, uptime probes), never called through the versioned API client, consistent with SYSTEM_ARCHITECTURE.md Section 10.10 treating them as a distinct concern from the business API.

### Consequences

- Decisions 1–3 are naming/tooling-version reconciliations, not functional deviations — no document content contradicts working code as a result.
- Decision 4 means `schema.prisma` will grow substantially over Milestones 2–9; each addition should be a small, reviewable diff following the same documented order, not a large batch retrofit.
- Decision 5 is a reminder that `npm install` succeeding is not sufficient evidence a dependency change is safe in this monorepo — `npm ci` (what Docker/CI actually run) must be verified too, ideally from a clean clone, not just a locally-patched `node_modules`.
- Decision 6 means every future commit — starting with this repository's first — is already gated by the standard this project's own roadmap sets, rather than that gate being added reactively later.

---

## ADR-002: Authentication Schema (Identity Foundation)

**Status:** Accepted
**Date:** 2026-07-21
**Milestone:** 2 — Authentication, Sprint 2.1.1

Adds the Identity migration batch (`User`, `UserRole`, `RefreshToken`, `EmailVerification`, `PasswordReset`, `ActorType`/`TenantStatus` enums) and pulls a minimal, schema-only `Tenant` + `TenantInvitation` forward from Milestone 3 to satisfy `User.tenantId`'s FK and unblock Sprint 2.2's invitation-acceptance task — `Tenants`-module business logic (`TenantSettings`, `TenantFeature`, controllers/services) stays in Sprint 3.1 as planned. Full context, alternatives considered, and consequences: [docs/adr/ADR-002-authentication-schema.md](adr/ADR-002-authentication-schema.md).

---

## ADR-003: Core Authentication Implementation

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 2 — Authentication ("Core Authentication" sprint)

Implements Register, Login, Logout, Refresh, and Get Current User end to end (backend + frontend), on top of ADR-002's schema — deliberately excluding email verification, password reset, Google OAuth, and RBAC enforcement, a narrower and differently-shaped scope than IMPLEMENTATION_ROADMAP.md §4's Sprint 2.1/2.2 originally specified. Notable decisions: the refresh token is an opaque, HMAC-peppered credential rather than a JWT; reuse detection distinguishes a token revoked by rotation (theft signal, triggers an all-device revoke) from one revoked by plain logout (a harmless dead session) — a real bug found and fixed during this sprint's own verification pass; `SecurityEventService` logs structurally rather than writing to a new, not-yet-scheduled `AuditLog` table. Full context, alternatives considered, and consequences: [docs/adr/ADR-003-core-authentication.md](adr/ADR-003-core-authentication.md); full technical reference: [docs/AUTHENTICATION.md](AUTHENTICATION.md), [docs/AUTH_FLOW.md](AUTH_FLOW.md).

---

## ADR-004: Account Security (Sprint 2.3)

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 2 — Authentication, follow-up "Sprint 2.3"

Closes the follow-up sprint ADR-003 itself recommended (minus Google OAuth/invitation-acceptance/Users CRUD, out of this sprint's charter): email verification, resend verification, password reset + confirmation, Redis-backed login-attempt tracking and temporary lockout, extended security event logging, and refresh-token revocation on password reset. Notable decisions: a minimal `Notifications` module (`sendEmail` only, SMTP with a log-only dev fallback) pulled forward from Milestone 9's full build-out; verification/reset tokens use a plain SHA-256 hash (not the refresh token's HMAC pepper, since they're short-lived and single-use); lockout state lives in Redis keyed by normalized email (never by user ID, to stay enumeration-resistant), not a new Postgres table; `EMAIL_NOT_VERIFIED` login enforcement — flagged in ADR-003 as a deferred gap — is now switched on. Full context, alternatives considered, and consequences: [docs/adr/ADR-004-account-security.md](adr/ADR-004-account-security.md).

---

## ADR-005: Authorization / RBAC (Sprint 2.4)

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 3 — IMPLEMENTATION_ROADMAP.md calls this slot "Sprint 3.1"; implemented as a narrower, RBAC-only charter here.

Builds the RBAC enforcement layer on top of the `Role`/`Permission`/`RolePermission`/`UserRole` schema and JWT `roles` claim that already existed (ADR-002): a permission resolver with Redis caching (union across all held roles, since `User.roles` is many-to-many), four backend guards (`RolesGuard`, `PermissionGuard`, `TenantScopedGuard`, `SuperAdminGuard`), `@Roles`/`@RequirePermission`/`@CurrentTenant` decorators, a request-scoped `TenantContextService`, and a guard-layer role-rank interpretation ("role hierarchy") that leaves the underlying flat schema unchanged. Frontend: `PermissionService`, `roleGuard`, an `*appHasPermission` structural directive, and a nav-filtering utility — deliberate, documented duplicates of the backend's rank/permission logic, since no shared types package exists. Notable decision: `SUPER_ADMIN` is granted an explicit, logged bypass on `RolesGuard`/`PermissionGuard` — a reasoned, requester-confirmed deviation from SYSTEM_ARCHITECTURE.md Section 8.4's original "no implicit tenant-scoped power for Super Admin" design, mitigated by a single shared chokepoint (`SuperAdminBypassService`) and mandatory audit logging via `SecurityEventService`. `TenantScopedGuard` and `TenantContextService` ship as a baseline/primitive respectively, with no per-resource-ID ownership check or business-module consumer yet — both explicitly flagged as open items for the module that first needs them. Full context, the SUPER_ADMIN bypass's full reasoning, alternatives considered, and consequences: [docs/adr/ADR-005-rbac.md](adr/ADR-005-rbac.md).

---

## ADR-006: Multi-Tenant SaaS Engine (Milestone 3)

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 3 — Multi-Tenant SaaS Engine

Builds the tenant infrastructure layer ADR-005 explicitly left open: the full `Tenants` module (`Tenant` profile/lifecycle, namespaced `TenantSettings`, `TenantInvitation` create/list/revoke/accept), a reworked `TenantContextService` that becomes the platform's *sole* authoritative tenant-context resolver (fed by a new, decision-free `TenantMiddleware`), the `TenantScopedRepository` base-repository pattern every future tenant-owned module extends, `TenantActiveGuard` (backend and frontend), a real persisted **platform-wide** `AuditLog` (pulled forward from Milestone 9), and Platform Admin tenant switching (impersonation via `X-Impersonate-Tenant-Id`, honored only for `SUPER_ADMIN` and spoofing-protected for every other role). Notable decisions, each confirmed with the requester: `TenantSettings` is five independent, arbitrary-JSON namespaces rather than flat columns, structured for future expansion; invitations stay under `/tenant/invitations` rather than the originally-implied `/users` path, since full `Users` staff-CRUD remains unbuilt; `GET /auth/me` now returns `activeTenantId`, the *resolved* tenant context (which can differ from the JWT's own `tenantId` claim for an impersonating Super Admin); `TenantScopedGuard`'s behavior changed — a `SUPER_ADMIN` with no impersonation header now fails it, rather than passing unconditionally as before; the pre-existing `@CurrentTenant()` decorator (ADR-005, zero real consumers) was removed as newly inconsistent with the impersonation-aware resolution model; `TenantFeature`, `Subscription`-linked lifecycle, and the composite-FK cross-tenant pattern (documented as the mandatory Milestone-4-onward convention, not yet exercised) are explicitly deferred. Full context, the impersonation design and alternatives considered, and consequences: [docs/adr/ADR-006-multi-tenant-saas-engine.md](adr/ADR-006-multi-tenant-saas-engine.md); full technical reference: [docs/TENANT_ARCHITECTURE.md](TENANT_ARCHITECTURE.md).
