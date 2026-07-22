# ADR-003: Core Authentication Implementation

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 2 — Authentication ("Core Authentication" sprint)
**Related:** docs/AUTHENTICATION.md, docs/AUTH_FLOW.md, docs/IMPLEMENTATION_ROADMAP.md §4 (Sprint 2.1/2.2), docs/API_SPECIFICATION.md §4, docs/FRONTEND_ARCHITECTURE.md §5, docs/adr/ADR-002-authentication-schema.md

---

## Decision

Implement, both backend and frontend, exactly five auth capabilities — Register, Login, Logout, Refresh, Get Current User — as a single sprint, explicitly excluding email verification, password reset, Google OAuth, and RBAC authorization enforcement. This is a **narrower, differently-shaped scope** than IMPLEMENTATION_ROADMAP.md §4's existing Sprint 2.1 ("Backend Auth & Users" — includes forgot/reset-password, verify-email, Users CRUD) and Sprint 2.2 ("Frontend Auth, Google OAuth & Invitations" — includes Google OAuth, accept-invitation). No new Prisma migration was needed — the schema ADR-002 already added (`User`, `UserRole`, `RefreshToken`, minimal `Tenant`) covers everything this sprint touches.

## Context

The roadmap's original Sprint 2.1/2.2 split bundles this sprint's five endpoints together with several capabilities that were explicitly out of scope for this pass: email verification, password reset, Google OAuth, and staff-invitation acceptance. Implementing the roadmap's literal scope would have directly contradicted the sprint's own explicit requirements. Rather than silently drift from the roadmap or silently implement a superset nobody asked for, this ADR records the rescoping as a deliberate decision, consistent with the precedent ADR-002 already set for logging a scheduling deviation before proceeding rather than after the fact.

## Alternatives Considered

1. **Implement Sprint 2.1/2.2 exactly as roadmapped.** Rejected outright — directly contradicts explicit instructions naming email verification, password reset, and Google OAuth as *not* to be implemented this pass.
2. **Implement only the five endpoints, backend only, deferring all frontend work to a literal "Sprint 2.2."** Rejected — the task explicitly asked for both backend and frontend (login/register pages, auth state, guards, interceptor) in the same pass; splitting them would leave a backend with no way to exercise it end to end.
3. **Implement the five endpoints across both stacks, explicitly excluding email verification/password reset/Google OAuth/RBAC, and log the roadmap deviation via ADR (chosen).** Matches the actual instructions exactly, keeps the change reviewable as one coherent unit (a complete, working, testable auth slice), and follows the project's own established pattern (ADR-001 decision 4, ADR-002) of building only what a given increment actually needs rather than a whole milestone's superset.

## Key Design Decisions (Summary — Full Rationale in AUTHENTICATION.md)

| Decision | Summary | Detail |
|---|---|---|
| Refresh token is opaque, not a JWT | A JWT refresh token is offline-verifiable and thus harder to individually revoke; an opaque, server-tracked token forces every use through the one DB lookup that makes rotation/revocation/reuse-detection possible. | AUTHENTICATION.md §4.1 |
| Refresh-token hash uses a separate HMAC pepper (`JWT_REFRESH_SECRET`) | Satisfies "use separate secrets" for access vs. refresh credentials without needing a second JWT signing key the refresh token doesn't need. | AUTHENTICATION.md §4.2 |
| Reuse detection keys off `replacedBySessionId`, not `revokedAt` alone | A token revoked by rotation (theft signal) and a token revoked by plain logout (a dead, harmless session) both set `revokedAt` — only rotation additionally sets `replacedBySessionId`. Treating any revoked-token replay as reuse would mean logging out on one device could spuriously mass-sign-out every other device. **Found and fixed during this sprint's own manual verification pass**, before it shipped. | AUTHENTICATION.md §4.5 |
| `SecurityEventService` logs, doesn't persist to a new table | `AuditLog` is explicit Milestone 9 scope; adding it now would be a forward-reference this project's incremental-migration discipline (ADR-001, ADR-002) exists to avoid. | AUTHENTICATION.md §6 |
| `User`/`Tenant` Prisma access lives inside `AuthModule`'s own `infrastructure/` layer | No standalone `Users`/`Tenants` modules were created. Mirrors ADR-002's own precedent of provisioning only what the current increment needs; the real modules (staff CRUD, invitations, `TenantSettings`, atomic tenant-provisioning transaction) remain Milestone 3 scope. | AUTHENTICATION.md §8 |
| CSRF double-submit token on `/auth/refresh` deferred | `SameSite=Strict` + `HttpOnly` is the implemented, non-negotiable primary control; the double-submit token is documented SYSTEM_ARCHITECTURE.md §9.10 defense-in-depth, explicitly raised to and deferred by product decision during this sprint's planning. | AUTHENTICATION.md §8 |
| `/auth/refresh` rate-limited per-IP, not strictly per-session | API_SPECIFICATION.md §2.10 specifies "keyed by session, not user" for this endpoint; true per-session tracking needs the cookie parsed before the throttler guard runs. Documented simplification, not a silent gap. | AUTHENTICATION.md §5 |
| Register does not establish a session; response message changed | Already the literal documented contract for session issuance (API_SPECIFICATION.md §4 never included tokens in the register response) — but the response `message` ("Verification email sent.") and FRONTEND_ARCHITECTURE.md §5.2's onboarding-redirect description both assumed capabilities (email sending, an onboarding route) that don't exist yet. Both source documents amended in this same change per IMPLEMENTATION_ROADMAP.md §8.1. | AUTHENTICATION.md §7 |
| Login does not enforce `403 EMAIL_NOT_VERIFIED` | No verification flow exists this sprint to ever clear the flag; enforcing it would permanently lock out every user. `isEmailVerified` is still stored accurately (defaults `false`), just not read by the login check yet — a known gap closed when email verification ships. | AUTHENTICATION.md §7 |
| `test/integration/` jest runner wired up | The folder existed since Milestone 1 but had no jest config and wasn't in CI — this sprint's integration tests would have had nowhere to run otherwise. Added `test/integration/jest-integration.json`, the `test:integration` npm script, and a CI step. | `.github/workflows/ci.yml` |

## Consequences

- IMPLEMENTATION_ROADMAP.md §4's Sprint 2.1 and Sprint 2.2 entries are now partially complete (the five endpoints + their frontend, done) and partially still open (email verification, password reset, Google OAuth, staff-invitation acceptance, `Users` CRUD endpoints). The roadmap document is annotated in this same change to reflect this rather than left silently inaccurate — a follow-up sprint should be scheduled to close the remaining items, likely as a renumbered "Sprint 2.3."
- RBAC is **not enforced** anywhere yet: every authenticated user (any role) can currently call every authenticated endpoint. This is safe only because no role-sensitive endpoint exists in this sprint's scope. Milestone 3, Sprint 3.1 (`RolesGuard`/`PermissionGuard`/`TenantScopedGuard`) closes this gap — it must land before any role-sensitive endpoint is added in Milestone 4+.
- The `AuthModule`-internal `User`/`Tenant` repositories will need to be reconciled with the real `Users`/`Tenants` modules when Milestone 3/4 build them — likely by having those modules' public services delegate to (or absorb) what `AuthModule` already built, following the module-boundary rule (no cross-module reach into another module's `infrastructure`/`domain` internals, SYSTEM_ARCHITECTURE.md §2.3) rather than duplicating User/Tenant Prisma access a second time.
- A CSRF double-submit token for `/auth/refresh` remains a documented, not-yet-scheduled hardening item.

## File Manifest

**Backend:** `src/modules/auth/**` (domain ports/entities, application services — `PasswordService`, `TokenService`, `SessionService`, `SecurityEventService`, `AuthService` — infrastructure Prisma repositories, interface controller/DTOs/guard/decorator/mapper), `src/common/constants/auth.constants.ts`, `src/common/utils/slugify.util.ts`, `src/common/validators/is-iana-timezone.validator.ts`, `src/config/{configuration,env.validation,config.module}.ts` (edited), `src/app.module.ts` / `src/main.ts` (edited), `test/unit/auth/**`, `test/integration/**` (new runner + specs), `.github/workflows/ci.yml` (edited), `.env.example` (edited).

**Frontend:** `src/app/core/auth/**` (`AuthApiService`, `AuthStateService`, `SessionService`), `src/app/core/guards/{auth,guest-only}.guard.ts`, `src/app/core/interceptors/auth.interceptor.ts`, `src/app/core/api/api-client.ts` (edited — `withCredentials`), `src/app/shared/models/{user,tenant}.model.ts`, `src/app/shared/validators/{password-strength,match-field}.validator.ts`, `src/app/layouts/{auth-layout,dashboard-layout}/**`, `src/app/features/auth/**`, `src/app/features/dashboard-home/pages/app-dashboard-page/**`, `src/app/app.routes.ts` / `src/app/app.config.ts` (edited).

**Docs:** this file; docs/AUTHENTICATION.md; docs/AUTH_FLOW.md; docs/DECISIONS.md (index entry); docs/API_SPECIFICATION.md, docs/FRONTEND_ARCHITECTURE.md, docs/IMPLEMENTATION_ROADMAP.md (amendments); README.md; CHANGELOG.md.
