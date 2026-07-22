# SECURITY.md

## Security Reference

**Document Status:** As-Built
**Depends on:** docs/AUTHENTICATION.md, docs/adr/ADR-002-authentication-schema.md, docs/adr/ADR-003-core-authentication.md, docs/adr/ADR-004-account-security.md, docs/adr/ADR-005-rbac.md, SYSTEM_ARCHITECTURE.md §7–9
**Scope:** A single point of reference for this platform's authentication, authorization, and multi-tenancy-isolation posture as actually built — pointing into AUTHENTICATION.md for implementation detail rather than duplicating it, and surfacing deliberate deviations from originally-documented designs prominently rather than leaving them buried in individual ADRs.

---

## 1. Authentication Summary

Full detail: docs/AUTHENTICATION.md.

- JWT access tokens (HS256, 15-minute expiry), held client-side in memory only — never `localStorage`.
- Refresh tokens are deliberately **not** JWTs: opaque, HMAC-peppered, server-tracked, rotated on every use, with reuse detection triggering an all-device revoke. Delivered via an httpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth`.
- Argon2id password hashing (production-tuned parameters above OWASP's stated minimum).
- Email verification required before login; Redis-backed login-attempt tracking with temporary account lockout (5 failed attempts / 15-minute window → 15-minute lockout), keyed by normalized email to stay enumeration-resistant.
- Every security-relevant event (register, login success/failure, logout, refresh, reuse detection, verification, password reset, lockout, **and RBAC's `SUPER_ADMIN_BYPASS`**) is recorded via `SecurityEventService` as a structured, tagged log line — not yet a persisted `AuditLog` table (explicit Milestone 9 scope), but designed to be trivially replayable into one.
- **Not yet implemented:** Google OAuth, MFA/WebAuthn, a CSRF double-submit token on `/auth/refresh` (the implemented `SameSite=Strict`/`HttpOnly` cookie is the primary control today).

---

## 2. Authorization (RBAC) Model

Full detail: docs/AUTHENTICATION.md §6b, docs/adr/ADR-005-rbac.md.

- **Roles** (fixed, flat enum — not a hierarchy in the schema): `SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF`. A user can hold more than one (`UserRole` is many-to-many), though today's seed data never assigns more than one.
- **Permissions** are named, colon-namespaced strings (`resource:action`, e.g. `billing:manage`) mapped to roles via `RolePermission`. A user's effective permission set is the **union** across every role they hold, resolved by `PermissionResolverService` and cached in Redis (`rbac:role-permissions:{RoleName}`, TTL `RBAC_PERMISSION_CACHE_TTL_SECONDS`, default 1 hour, TTL-only invalidation until a runtime role-management endpoint exists).
- **Guards:** `RolesGuard` (`@Roles()`), `PermissionGuard` (`@RequirePermission()`), `TenantScopedGuard` (baseline resolvable-tenant-context check), `SuperAdminGuard` (strict `SUPER_ADMIN`-only, reserved for the future `/admin/*` surface). All compose on `JwtAuthGuard`'s `request.user`.
- **Role hierarchy** is a guard-layer rank (`SUPER_ADMIN` > `OWNER` > `MANAGER` > `STAFF`), not a schema concept — `@Roles()` declares a single minimum role, satisfied by that role or anything ranked higher. The underlying `Role`/`Permission`/`RolePermission` mapping stays flat and direct.

### 2.1 The SUPER_ADMIN Bypass — a Deliberate, Logged Deviation

`SUPER_ADMIN` is granted an **explicit bypass** on `RolesGuard`/`PermissionGuard`: it passes any tenant-scoped role/permission requirement check unconditionally. This is a deliberate deviation from this project's original design (SYSTEM_ARCHITECTURE.md §8.4), which specified **zero implicit tenant-scoped power** for Super Admin, acting only through a separate `/admin/*` surface — a design chosen specifically to avoid a shared code path where a bug could accidentally grant cross-tenant access.

This is exactly the kind of decision a security-focused document should surface prominently, not bury in an ADR nobody re-reads:

- **Why:** confirmed with the requester as an explicit sprint requirement (a "Platform Admin bypass"), prioritizing operational/support convenience over the original design's stricter separation.
- **Mitigations:** the bypass lives in exactly one shared, unit- and integration-tested chokepoint (`SuperAdminBypassService`) rather than scattered inline checks; every use is logged (`SecurityEventService.record('SUPER_ADMIN_BYPASS', { userId, tenantId, route, ...requirement })`); the bypass is scoped narrowly to role/permission *requirement* checks only — `TenantScopedGuard`'s resource-context checks are unaffected and are explicitly designed to apply to `SUPER_ADMIN` unchanged once the per-resource-ID extension (below) is built.
- **Full reasoning and alternatives considered:** docs/adr/ADR-005-rbac.md.

If this platform's threat model changes such that this tradeoff is no longer acceptable, the fix is localized: remove the bypass call from `RolesGuard`/`PermissionGuard` and route Super Admin actions exclusively through `SuperAdminGuard`/`/admin/*`, which already exists and is unaffected.

---

## 3. Multi-Tenancy Isolation Posture

- Shared database, shared schema, `tenant_id`-scoped rows (SYSTEM_ARCHITECTURE.md §8.1) — the chosen strategy, not schema-per-tenant.
- **As of Milestone 3 (docs/adr/ADR-006):** `TenantScopedGuard` now delegates entirely to `TenantContextService` (docs/TENANT_ARCHITECTURE.md §3), the sole authoritative resolver of tenant context platform-wide. This is a **behavior change** from the baseline described below: a `SUPER_ADMIN` with no impersonation header now *fails* this guard (`403 INVALID_TENANT_CONTEXT`) rather than passing unconditionally with `tenantId: null` — there is no "my tenant" for a Super Admin acting on a genuinely tenant-scoped resource without explicitly declaring which one.
- `TenantScopedRepository` (`core/database/`) is the first real per-resource-ID ownership check this platform has: `findByIdOrThrow` returns `404 TENANT_RESOURCE_NOT_FOUND` (never `403`) for a lookup matching an `id` belonging to a different tenant, identically to a lookup matching no row at all — exactly the anti-enumeration behavior the "still open" note below used to flag as unbuilt. `PrismaTenantInvitationRepository` is its first consumer; every Milestone-4-onward tenant-owned repository extends it.
- **Still open:** the composite-foreign-key cross-tenant-safe relation pattern (PRISMA_SCHEMA.md §14.4, DATABASE_DESIGN.md Risk DB-R1) is documented as the mandatory Milestone-4-onward convention (docs/TENANT_ARCHITECTURE.md §4.1) but not yet exercised — no tenant-owned model pair in this milestone's scope (`TenantSettings`/`TenantInvitation`, both referencing only `Tenant`) needs it. It becomes load-bearing starting with Milestone 4's `Employee`↔`Service` relation.
- **Tenant switching (impersonation):** a `SUPER_ADMIN` may act on a specific tenant via `X-Impersonate-Tenant-Id`, resolved exclusively by `TenantContextService` and ignored entirely (spoofing-protected) for every other role — full design, alternatives considered, and mitigations in docs/adr/ADR-006. Every resolution is audit-logged (`SUPER_ADMIN_TENANT_SWITCH`).
- A cross-tenant access attempt returns `404 NOT_FOUND`, never `403`, per API_SPECIFICATION.md §2.3.1's anti-enumeration rule — this applies uniformly to `SUPER_ADMIN` too, unlike the role/permission bypass above.

---

## 4. Known Gaps

Mirrors AUTHENTICATION.md §8's "Explicitly Out of Scope" list, security-relevant items only:

- Google OAuth, MFA/WebAuthn — not implemented.
- CSRF double-submit token on `/auth/refresh` — deferred; `SameSite=Strict`/`HttpOnly` is the primary control today.
- The composite-FK cross-tenant pattern — documented (§3), not yet exercised; no consumer until Milestone 4.
- `Users`/`UserRole` staff-CRUD (list/patch-role/deactivate/last-owner-protection) — still unbuilt; only invite-create/list/revoke/accept exist (Milestone 3, docs/TENANT_ARCHITECTURE.md).
- Role-change → session/JWT invalidation — a user's already-issued access token still carries their old `roles` claim after a role change; moot today (no role-assignment endpoint exists yet), but should call `SessionService.revokeAllForUser()` once one is built.
- `AuditLog` as a persisted table — **now built** (Milestone 3, docs/adr/ADR-006, pulled forward from its originally-planned Milestone 9 slot), but scoped to the events that milestone's own modules write (tenant lifecycle/settings/invitations, Super Admin tenant-switch). `SecurityEventService`'s auth/RBAC structured log lines (register, login, `SUPER_ADMIN_BYPASS`, etc.) are **not yet** replayed into it — that backfill remains Milestone 9 scope, per `SecurityEventService`'s own doc comment.
