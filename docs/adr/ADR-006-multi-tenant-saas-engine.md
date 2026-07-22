# ADR-006: Multi-Tenant SaaS Engine (Milestone 3)

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 3 — Multi-Tenant SaaS Engine
**Related:** docs/TENANT_ARCHITECTURE.md, docs/SYSTEM_ARCHITECTURE.md §2.3–2.4/§8, docs/DATABASE_DESIGN.md §5/§8/Risk DB-R1, docs/PRISMA_SCHEMA.md §4/§14.4, docs/API_SPECIFICATION.md, docs/adr/ADR-002-authentication-schema.md, docs/adr/ADR-005-rbac.md, docs/IMPLEMENTATION_ROADMAP.md Sprint 3.1

---

## Decision

Build the tenant infrastructure layer only — tenant profile/lifecycle, namespaced tenant settings, staff invitations + acceptance, the tenant-context resolution mechanism (middleware + service), Platform Admin tenant switching, a platform-wide persisted audit trail, and the tenant-scoped repository base class every future domain module extends. Explicitly **not** built: salon management, employees, services, scheduling, WhatsApp, AI, or billing — per the requester's explicit scope boundary.

This ADR also records nine deliberate deviations from IMPLEMENTATION_ROADMAP.md's original Sprint 3.1 scope and PRISMA_SCHEMA.md's original design, each confirmed with the requester before implementation — the same "narrower/different-than-roadmap, logged not silent" precedent ADR-003/004/005 already established for the two prior authentication sprints.

## Context

IMPLEMENTATION_ROADMAP.md's Sprint 3.1 entry ("Tenant Context, RBAC Enforcement & Isolation Proof") already had its RBAC-enforcement slice completed under a narrower charter (ADR-005, "Sprint 2.4"), which explicitly left the full `Tenants` module, `TenantSettings`, `TenantInvitation` business logic, the composite-FK pattern, and the standing isolation regression suite as open items for "a future sprint before Milestone 4." This ADR is that sprint, executed as Milestone 3 per the requester's own numbering, with an initial plan proposed and then adjusted per the requester's explicit feedback before implementation began.

## Key Design Decisions

| Decision | Summary | Rationale |
|---|---|---|
| `AuditLog` is platform-wide, not tenant-specific | `tenantId`/`entityId`/`actorId` all nullable; lives in `core/audit/`, not `modules/tenants/`; any future module can inject `AuditLogService` and record its own event types. | Explicit requester instruction. A tenant-scoped-only design would have forced every future platform-level event (e.g. a future cross-tenant admin action) into an awkward shape or a second table. |
| `AuditLog` pulled forward from Milestone 9 | Real persisted table now, not a structured log line. | Mirrors the exact precedent ADR-002 set for `Tenant`/`TenantInvitation` — infrastructure needed by *this* milestone's real requirement (a queryable trail for tenant lifecycle/settings/invitation events) shouldn't wait for a later milestone's turn just because a design doc originally scheduled it there. |
| `AuditLog.id` stays `gen_random_uuid()`, not app-generated UUIDv7 | PRISMA_SCHEMA.md §1.1 recommends UUIDv7 for this table's eventual 10M+-row index locality. | That benefit doesn't materialize at this milestone's volume; adopting it now means a new dependency (`uuidv7` npm package) for zero present benefit. Flagged as a deferred, not forgotten, optimization. |
| `/auth/me` returns `activeTenantId`, resolved via `TenantContextService` | Distinct from `user.tenantId` (the JWT's home-tenant claim) — for an impersonating `SUPER_ADMIN` these differ. | Explicit requester instruction: "the frontend always knows the resolved tenant." Resolved in the controller (which owns the request-scoped `TenantContextService`) and passed into `AuthService.me()` as a plain argument, keeping `AuthService` itself a singleton rather than propagating request-scope into it. |
| Invitations stay under `/tenant/invitations`, not `/users` | API_SPECIFICATION.md's original design implied `POST /users` for invite-creation. | Confirmed with the requester: a full `Users` staff-CRUD module (list-all/patch-role/deactivate/last-owner-protection) is real, separate scope not requested here. `TenantInvitation` is genuinely tenant-owned data, so `/tenant/invitations` is a defensible, minimal-footprint home for exactly the invite/list/revoke/accept lifecycle this milestone needs — not a permanent renaming of the eventual `/users` surface. |
| `TenantSettings` is five independent JSON namespaces, not flat columns | `general`/`localization`/`business`/`notifications`/`security`, each `Json @default("{}")`. | Explicit requester instruction to structure for future expansion. No namespace has concrete fields yet — populating them is each future milestone's (Scheduling/AI/Notifications) own job, never a schema migration once the container exists. |
| Tenant context resolved exclusively through `TenantMiddleware` + `TenantContextService` | No controller/service anywhere else reads `X-Impersonate-Tenant-Id` or `request.user.tenantId` directly; the pre-existing `@CurrentTenant()` decorator (ADR-005, zero real consumers) was removed. | Explicit requester instruction. A second code path reading tenant context independently is exactly the kind of accidental-inconsistency risk this milestone's whole design exists to close — `@CurrentTenant()`'s synchronous `request.user.tenantId` read would have been silently wrong for an impersonating `SUPER_ADMIN`. |
| Composite-FK cross-tenant pattern documented, not exercised | `TenantScopedRepository` (the application-layer half) ships now; the schema-level compound-unique/compound-FK mechanism (PRISMA_SCHEMA.md §14.4) is written up as the mandatory Milestone-4-onward convention. | No model in this milestone's scope (`TenantSettings`, `TenantInvitation`) references another tenant-owned entity — both only reference `Tenant` directly. Building the schema mechanism against zero real consumers would be speculative; Milestone 4's `Employee`↔`Service` relation is its first real target. |
| `TenantActiveGuard` ships as a structural skeleton | Blocks `SUSPENDED`/`CANCELLED` tenants from mutating endpoints (`402 TENANT_SUSPENDED`); `SUPER_ADMIN` always bypasses it; applied per-route to mutating actions only. | No plan-limit/usage logic — that's Milestone 8 (`Subscription` doesn't exist). This is exactly the "guard's structural presence starts here, full enforcement lands later" scope IMPLEMENTATION_ROADMAP.md's Sprint 3.1 entry already specified. |
| Admin surface stays a narrow slice | Only `GET /admin/tenants` + suspend/reactivate. `GET /admin/users`/`GET /admin/system` remain unbuilt. | Those two endpoints need `Users` staff-CRUD and platform usage/analytics data (AI/WhatsApp volume, queue depths) that don't exist until later milestones — building them now would mean building against nothing real, the same anti-pattern ADR-005's "no throwaway production route" decision already rejected once. |

## Platform Admin Tenant Switching — Design and Alternatives

### Chosen design: a validated, audited request header

A `SUPER_ADMIN` caller sends `X-Impersonate-Tenant-Id: <uuid>` on any tenant-scoped request. `TenantMiddleware` copies it onto the request object with **zero interpretation** (it runs before `JwtAuthGuard`, so there's no `request.user` yet to check a role against). `TenantContextService` — the sole authority — then:

1. Ignores it entirely unless the caller's JWT carries the `SUPER_ADMIN` role (spoofing protection: a non-admin cannot influence tenant resolution via this header no matter what it contains).
2. Validates the target tenant exists and isn't soft-deleted, else `404 TENANT_RESOURCE_NOT_FOUND` (never `403` — the platform's standing anti-enumeration convention).
3. Records a `SUPER_ADMIN_TENANT_SWITCH` `AuditLog` row on every successful resolution (memoized per request, so a request that resolves tenant context multiple times internally only writes one row).

No new token type is issued; no server-side "impersonation session" exists. Every request independently declares which tenant it's acting on, exactly like this platform's existing stateless-JWT model for everything else.

### Alternatives considered

1. **Issue a short-lived, tenant-scoped JWT when a Super Admin "starts" impersonating** (a real second token, swapped in client-side). Rejected: doubles the token-management surface (two access tokens, two expiries, two refresh stories) for a capability the header achieves with zero new server-side state. It would also make "stop impersonating" a token-swap operation instead of simply omitting a header, adding client complexity without a corresponding security benefit — the header is equally revocable (just stop sending it) and equally auditable (every use is logged regardless of mechanism).
2. **A stateful server-side "impersonation session" record** (e.g. a Redis key: this admin is currently impersonating this tenant, keyed by their user id). Rejected: introduces a second source of truth that can drift from what the client believes it's doing (a stale Redis key outliving the frontend's own signal state), and reintroduces exactly the kind of implicit, ambient tenant-scoped power SYSTEM_ARCHITECTURE.md §8.4 originally wanted Super Admin to *not* have outside an explicit, per-request declaration.
3. **Extend the existing `SUPER_ADMIN` bypass (ADR-005) to also imply "use tenant X"** by having the frontend send a client-supplied `tenantId` in the request body/query, resolved without a header. Rejected: API_SPECIFICATION.md §2.14 already states, platform-wide, that no endpoint accepts a client-supplied `tenantId` for determining *which* tenant's data to operate on, precisely because that shape is the textbook cross-tenant IDOR vulnerability. A dedicated, clearly-named header (never a body/query field competing with real business data) keeps this exception visually and structurally distinct from that rule everywhere it's read.
4. **No impersonation at all — Super Admin only ever sees read-only cross-tenant admin views** (the original SYSTEM_ARCHITECTURE.md §8.4 posture, before ADR-005's bypass). Rejected: the explicit milestone scope calls for "Platform Admin tenant switching" as a first-class deliverable — a support engineer needs to *act* on a tenant's settings/invitations, not just view them from the outside.

### Mitigations

- Single authoritative resolution point (`TenantContextService`) — no second code path could accidentally honor the header differently.
- Spoofing protection is unconditional and covered by both a unit test (mocked request) and an integration test (real HTTP, real JWT, real non-admin role).
- Every resolution is audit-logged with the route hit, not just a generic "admin did something" entry.
- The header-setting UI (Admin Tenants page's "Act as") is itself reachable only through `/admin/*`, gated by the same `SUPER_ADMIN`-only route guard as the rest of the console — a non-admin user has no UI path to even discover the header exists, on top of the backend ignoring it for them regardless.

## Consequences

- `TenantScopedGuard`'s behavior changed from ADR-005's version: a `SUPER_ADMIN` with no impersonation header now fails it (`403 INVALID_TENANT_CONTEXT`) rather than passing with `tenantId: null`. Existing tests for the old behavior were rewritten, not patched around.
- `@CurrentTenant()` (ADR-005) is removed. Any future code that would have reached for it should inject `TenantContextService` directly instead.
- `AuthModule` and `CoreModule` and `TenantsModule` now form a genuine three-way circular module-import graph (`forwardRef()` on every edge) — a real, intentional Nest pattern, verified by actually booting the application (not just type-checking), since `forwardRef` resolves NestJS's DI-graph ordering but does not by itself fix a genuine circular *file*-import graph unless applied consistently on every edge of the cycle; this was discovered empirically (an `UndefinedModuleException` at boot) before being corrected.
- `ResponseTransformInterceptor` gained a `paginated()` escape hatch (`common/utils/paginated-response.util.ts`) so `GET /admin/tenants` — this codebase's first list/pagination endpoint — could return real `meta.pagination`, not a value silently discarded by the interceptor's prior "always wrap the whole return value as `data`" behavior. Every future list endpoint benefits without repeating this problem.
- The requester's explicit acceptance-test asks (cross-tenant isolation, impersonation, spoofing protection) are now permanent, standing regression suites (`test/integration/tenants/`, `test/integration/admin/`, `test/integration/core/tenant-scoped.integration-spec.ts`), re-run in CI for every future PR — not one-off manual verification. A full manual browser walkthrough (registration → settings → invitation → impersonation → suspend/reactivate) was additionally performed and is not itself part of the automated suite.

## File Manifest

See docs/TENANT_ARCHITECTURE.md §9 for the complete file list (new/modified/removed, backend and frontend).
