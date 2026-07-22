# TENANT_ARCHITECTURE.md

## Multi-Tenant SaaS Engine — Implementation Reference

**Document Status:** As-Built
**Milestone:** 3 — Multi-Tenant SaaS Engine
**Depends on:** SYSTEM_ARCHITECTURE.md §2–8, DATABASE_DESIGN.md §5/§8, PRISMA_SCHEMA.md §4/§14.4, API_SPECIFICATION.md, docs/AUTHENTICATION.md, docs/SECURITY.md, docs/adr/ADR-005-rbac.md, docs/adr/ADR-006-multi-tenant-saas-engine.md
**Scope:** What Milestone 3 actually built — tenant profile/lifecycle, namespaced tenant settings, staff invitations, the tenant-context resolution mechanism (middleware + service), Platform Admin tenant switching (impersonation), the platform-wide audit trail, and the tenant-scoped repository pattern every future domain module builds on. Salon management, scheduling, WhatsApp, AI, and billing are explicitly out of scope — see docs/adr/ADR-006 for every deliberate scope decision.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Tenant profile read/update | `GET/PATCH /tenant` | `modules/tenants` |
| Tenant settings (5 namespaces) | `GET/PATCH /tenant/settings` | `modules/tenants` |
| Staff invitations | `POST/GET /tenant/invitations`, `DELETE /tenant/invitations/:id` | `modules/tenants` |
| Invitation acceptance | `POST /auth/accept-invitation` | `modules/auth` (calls into `modules/tenants`) |
| Platform Admin: tenant list + lifecycle | `GET /admin/tenants`, `POST /admin/tenants/:id/{suspend,reactivate}` | `modules/admin` |
| Tenant switching (impersonation) | `X-Impersonate-Tenant-Id` header, honored by every tenant-scoped endpoint above | `core/context`, `core/middleware` |
| Platform-wide audit trail | (no endpoint yet — `AuditLogService.findForTenant` exists for a future screen) | `core/audit` |

Not built: `Users`/`UserRole` staff-CRUD (list/patch-role/deactivate — only invite/accept exist), `TenantFeature`, `Subscription`-linked lifecycle, `GET /admin/users`, `GET /admin/system`. All flagged in ADR-006, not silent gaps.

---

## 2. Data Model

### 2.1 `Tenant` (unchanged this milestone)

Already existed (pulled forward from Milestone 2, ADR-002) — `status`, `trialEndsAt`, `suspendedAt`, profile fields. Milestone 3 adds behavior (lifecycle transitions, profile updates) but no new columns.

### 2.2 `TenantSettings` — namespaced for future expansion

Per the requester's explicit brief, **not** a flat column-per-field design. Five independent JSON columns, each defaulting to `{}`:

```prisma
model TenantSettings {
  tenantId String @unique
  general       Json @default("{}")
  localization  Json @default("{}")
  business      Json @default("{}")
  notifications Json @default("{}")
  security      Json @default("{}")
}
```

No namespace has concrete fields yet. Each is owned by whichever future milestone first needs one:
- `business`/`notifications` — Scheduling (M5), AI (M7), Notifications (M9)
- `general`/`localization`/`security` — no concrete consumer identified yet

Adding a field to a namespace is an application-layer change (validate it, read/write it in the service) — never a schema migration. `PATCH /tenant/settings` shallow-merges each provided namespace into the stored object (`PrismaTenantSettingsRepository.updateCategories`) so a partial update never wipes unrelated keys in the same namespace.

A `TenantSettings` row is created atomically alongside `Tenant`+`User(OWNER)` in `PrismaRegistrationRepository.registerTenantOwner`'s transaction. `TenantSettingsService.getSettings` defensively backfills one via `upsert` for any tenant that predates this migration.

### 2.3 `AuditLog` — platform-wide, not tenant-specific

Pulled forward from Milestone 9 (the same precedent ADR-002 set for `Tenant`/`TenantInvitation`), and — per explicit instruction — designed as a **reusable, platform-wide** table, not a Tenants-module-private one:

```prisma
model AuditLog {
  tenantId   String?   // nullable — genuinely platform-level events have no owning tenant
  action     String    // e.g. TENANT_SUSPENDED, SUPER_ADMIN_TENANT_SWITCH
  entityType String
  entityId   String?
  actorType  ActorType
  actorId    String?
  metadata   Json?
  ipAddress  String?
}
```

`AuditLogService` lives in `core/audit/` (not `modules/tenants/`) specifically so any future module can inject it and record its own `action`/`entityType` values without depending on Tenants. `id` uses standard `gen_random_uuid()`, not PRISMA_SCHEMA.md's recommended app-generated UUIDv7 — that optimization targets 10M+-row index locality (Milestone 9 territory) and isn't worth a new dependency (`uuidv7`) at this milestone's volume; a deferred follow-up, not an oversight.

**Events this milestone writes:** `TENANT_PROFILE_UPDATED`, `TENANT_SETTINGS_UPDATED`, `TENANT_SUSPENDED`, `TENANT_REACTIVATED`, `TENANT_INVITATION_CREATED`, `TENANT_INVITATION_REVOKED`, `TENANT_INVITATION_ACCEPTED`, `SUPER_ADMIN_TENANT_SWITCH`. Every other module adds its own values as it's built — never a schema change.

Distinct from `SecurityEventService` (auth/RBAC structured log lines, still not a persisted table, unchanged Milestone 9 scope, docs/SECURITY.md) — `AuditLog` is the persisted, queryable counterpart for *business-significant* events (DATABASE_DESIGN.md §8.2's `audit_logs`/`activity_logs` split).

### 2.4 `TenantInvitation` (unchanged schema, new behavior)

Schema already existed (ADR-002). This milestone adds the full lifecycle: create (with duplicate-pending prevention), list pending, revoke, and — via `AuthModule` — validate/consume/accept.

---

## 3. Tenant Context Resolution — the Core Mechanism

The single most important design decision this milestone makes: **tenant context is resolved in exactly one place, `TenantContextService`, fed by exactly one upstream component, `TenantMiddleware`.** No controller, guard, or service anywhere else reads the impersonation header or `request.user.tenantId` directly.

### 3.1 Stage 1 — `TenantMiddleware` (`core/middleware/tenant.middleware.ts`)

Registered globally (`AppModule.configure()`, runs for every request, right after `RequestIdMiddleware`). Its only job: if `X-Impersonate-Tenant-Id` is present, copy it onto `request.impersonateTenantIdHeader`. **No authorization logic at all** — it runs before `JwtAuthGuard`, so `request.user` doesn't exist yet at this point. This is deliberate: the middleware is trivially safe (it can't grant access to anyone, since it makes no decisions), which is exactly why the real authority check is pushed to stage 2.

### 3.2 Stage 2 — `TenantContextService` (`core/context/tenant-context.service.ts`)

Request-scoped (`Scope.REQUEST`), injected wherever a resolved tenant is needed (guards, controllers). Resolution rules, in order:

1. **Non-`SUPER_ADMIN` caller:** always the JWT's own `tenantId` claim. The impersonation header is read but has **zero effect** — this is the spoofing-protection property, verified by both an integration test (`tenant-scoped.integration-spec.ts`) and a unit test (`tenant-context.service.spec.ts`).
2. **`SUPER_ADMIN`, no impersonation header:** `getTenantId()` returns `null` (a valid state — e.g. `/auth/me` for a non-impersonating admin). `requireTenantId()` throws `InvalidTenantContextException` (403) — a genuinely tenant-scoped operation has no "my tenant" for a Super Admin to fall back to.
3. **`SUPER_ADMIN` with an impersonation header:** the target tenant is looked up (`deletedAt: null`); a miss throws `TenantResourceNotFoundException` (404, never 403 — the platform's standing anti-enumeration rule, API_SPECIFICATION.md §2.3.1); a hit returns that tenant's id **and records a `SUPER_ADMIN_TENANT_SWITCH` audit event**.

Resolution is memoized per request (a `Promise` cached on the service instance) — calling it from a guard and again later from a controller/service in the same request hits the database and writes the audit log **at most once**, verified by a dedicated unit test.

### 3.3 Consumers

- `TenantScopedGuard` — now just calls `requireTenantId()`. This is a **behavior change** from the original (Sprint 2.4/ADR-005) version, which let `SUPER_ADMIN` through unconditionally with `tenantId: null`. That was correct for its time (no tenant-owned resource existed to check against) — this milestone is the concrete mechanism the guard's own doc comment always said would eventually be needed.
- `TenantActiveGuard` (new) — resolves the tenant, checks `status`, throws `TenantSuspendedException` (402) for `SUSPENDED`/`CANCELLED`. `SUPER_ADMIN` always bypasses it (acting on a suspended tenant is exactly the support scenario Super Admin access exists for). Applied only to mutating routes — reads stay reachable on a suspended tenant.
- Every `Tenants`/`Admin` controller — injects `TenantContextService` directly and calls `requireTenantId()`/`getTenantId()` inline, rather than a param decorator. The pre-existing `@CurrentTenant()` decorator (Sprint 2.4, zero real consumers) was **removed** this milestone: it read `request.user.tenantId` synchronously, which is now provably wrong for an impersonating Super Admin — keeping it around would have been a live landmine inconsistent with the new authoritative resolution path.

### 3.4 `/auth/me` reflects resolved context

Per explicit instruction, authenticated responses return the *resolved* tenant context, not just the JWT's own claim. `GET /auth/me`'s response gained `activeTenantId`, resolved via `TenantContextService.getTenantId()` (the controller resolves it and passes it into `AuthService.me()`, keeping that service a plain singleton rather than propagating request-scope). For a non-impersonating Super Admin this is `null`; for everyone else it always equals `tenant?.id`.

---

## 4. Tenant-Aware Repository Pattern

`core/database/tenant-scoped.repository.ts`'s `TenantScopedRepository<TModel>` is the template every future tenant-owned module's repositories extend (`PrismaTenantInvitationRepository` is the first real consumer). Every method takes `tenantId` as an explicit, non-optional first argument:

- `findFirstForTenant` / `findManyForTenant` / `createForTenant` — straightforward `where`-clause injection.
- `findByIdOrThrow` — the first real consumer of `TenantResourceNotFoundException` (reserved since ADR-005): a lookup matching an `id` belonging to a *different* tenant behaves identically to a lookup matching no row at all (404, never 403).
- `updateForTenant` — implemented as `updateMany({ where: { id, tenantId } })` (proving the row exists AND belongs to this tenant) followed by a `findUnique` re-read, **not** a single `update()` call — Prisma's `update()` only accepts a `WhereUniqueInput`, which doesn't admit an ad hoc `{ id, tenantId }` composite without a compound unique index.

`TenantSettings` (a 1:1-by-`tenantId` record, not "many rows per tenant each with their own id") deliberately does **not** extend this base — its natural lookup key is `tenantId` itself, a different access pattern than the base class targets.

### 4.1 Composite-FK cross-tenant pattern — documented, not yet exercised

DATABASE_DESIGN.md's Risk DB-R1 and PRISMA_SCHEMA.md §14.4 specify a composite-FK pattern for relations *between two tenant-owned entities* (e.g. a future `Employee` referencing a `Service`): a compound unique `(tenantId, id)` on the referenced table plus a compound FK `(tenantId, xId) REFERENCES x(tenantId, id)` on the referencing table. **No model in this milestone's scope needs it** — `TenantSettings`/`TenantInvitation` both only reference `Tenant` directly, never each other. This is the mandatory convention for Milestone 4 onward (starting with `Employee`↔`Service`): add the compound unique index and compound FK in the same migration that introduces the second tenant-owned entity in the relation, following the exact manual-migration-SQL mechanism PRISMA_SCHEMA.md §14.4 already specifies.

---

## 5. Platform Admin Tenant Switching (Impersonation)

Full reasoning and alternatives considered: docs/adr/ADR-006. Summary:

- **Mechanism:** a request header, `X-Impersonate-Tenant-Id`, honored only for `SUPER_ADMIN` callers (§3.2 above). No new token type, no server-side "impersonation session" — every request re-declares which tenant it's acting on, exactly like every other stateless-JWT decision this platform already makes.
- **Frontend:** `AuthStateService.impersonatedTenant` (a signal, session-lifetime only — cleared on logout/refresh, never persisted); `tenantImpersonationInterceptor` attaches the header when set; the Admin Tenants page's "Act as" button sets it and navigates to `/app/settings` (the one real tenant-scoped screen this milestone built); `DashboardLayout` shows a persistent "Acting as X — Return to my account" banner whenever it's active, so there is never ambiguity about whose data is on screen.
- **Spoofing protection:** verified at three levels — a backend unit test (`TenantContextService` ignores the header for non-`SUPER_ADMIN`), a backend integration test (same, over real HTTP with a real JWT), and by construction on the frontend (the header-setting UI is itself behind `/admin/*`'s `SUPER_ADMIN`-only route guard).
- **Audit trail:** every successful impersonation resolution writes a `SUPER_ADMIN_TENANT_SWITCH` `AuditLog` row (`tenantId`, `actorId`, the route hit) — not per guard-check, but once per request thanks to memoization (§3.2).

---

## 6. Endpoints Reference

See API_SPECIFICATION.md's amendment (Sections 6, 16, and the new "Impersonation" note in §2.14) for the full request/response contracts. Authorization summary:

| Endpoint | Roles | Permission | Notes |
|---|---|---|---|
| `GET /tenant` | STAFF+ | — | broadly readable |
| `PATCH /tenant` | MANAGER+ | `tenant:manage` | `TenantActiveGuard` applied |
| `GET /tenant/settings` | MANAGER+ | — | |
| `PATCH /tenant/settings` | MANAGER+ | `settings:manage` | `TenantActiveGuard` applied |
| `POST/GET/DELETE /tenant/invitations*` | MANAGER+ | `staff:invite` | create/delete are `TenantActiveGuard`-gated |
| `POST /auth/accept-invitation` | public (token is the credential) | — | |
| `GET /admin/tenants` | SUPER_ADMIN only | — | offset pagination |
| `POST /admin/tenants/:id/{suspend,reactivate}` | SUPER_ADMIN only | — | |

---

## 7. Deferred / Known Gaps (Not Forgotten)

- `TenantFeature` (per-tenant feature flags) — no requested consumer; not built.
- `Subscription`-integrated lifecycle — `suspend`/`reactivate` are Super-Admin-manual only; no automatic status sync from a subscription (Billing is Milestone 8).
- `Users`/`UserRole` staff-CRUD (list all staff, change role, deactivate, last-owner-protection) — only invite-create/list-pending/revoke and accept exist. `GET/PATCH/DELETE /users/*` remain unbuilt.
- `GET /admin/users`, `GET /admin/system` — explicit Milestone 9 scope.
- `TenantStatus.CANCELLED` transition — not wired (tied to subscription cancellation, Milestone 8).
- `AuditLog.id` as app-generated UUIDv7 — deferred until real volume justifies the dependency.
- Admin tenant list — offset pagination only, no `q`/`status` filter UI on the frontend yet (backend supports both).

---

## 8. Environment Variables

| Variable | Purpose |
|---|---|
| `TENANT_INVITATION_EXPIRES_IN_SECONDS` | Invitation token lifetime (default `604800` = 7 days). |

---

## 9. Files

**Backend — new:** `src/core/audit/{audit-log.service,audit-log.module}.ts`; `src/core/middleware/tenant.middleware.ts`; `src/core/database/tenant-scoped.repository.ts`; `src/core/guards/tenant-active.guard.ts`; `src/modules/tenants/**` (full module); `src/modules/admin/**` (full module); `src/common/utils/paginated-response.util.ts`; test files under `test/unit/{core,tenants}/` and `test/integration/{tenants,admin}/`.

**Backend — modified:** `prisma/schema.prisma`; `src/core/context/tenant-context.service.ts`; `src/core/guards/{tenant-scoped.guard,rbac.exceptions}.ts`; `src/core/core.module.ts`; `src/app.module.ts`; `src/config/{configuration,config.module,env.validation}.ts`; `src/modules/auth/{auth.module,application/auth.service,interface/auth.controller}.ts`; `src/modules/auth/domain/ports/registration-repository.port.ts`; `src/modules/auth/infrastructure/prisma-registration.repository.ts`; `src/common/interceptors/response-transform.interceptor.ts`; `test/integration/support/{test-app.factory,rbac-probe/rbac-probe.controller}.ts`.

**Backend — removed:** `src/core/decorators/current-tenant.decorator.ts` (superseded, zero real consumers — see §3.3).

**Frontend — new:** `src/app/core/api/{tenant-api,admin-api}.service.ts`; `src/app/core/interceptors/tenant-impersonation.interceptor.ts`; `src/app/core/guards/tenant-active.guard.ts`; `src/app/shared/models/{tenant-settings,invitation}.model.ts`; `src/app/features/settings/**`; `src/app/features/admin/**`; `src/app/features/auth/pages/accept-invitation-page/**`; `src/app/features/dashboard-home/pages/tenant-suspended-page/**`; `src/app/layouts/admin-layout/**`.

**Frontend — modified:** `src/app/core/auth/{auth-api.service,auth-state.service}.ts`; `src/app/layouts/dashboard-layout/**`; `src/app/app.{routes,config}.ts`; `src/app/features/auth/auth.routes.ts`.
