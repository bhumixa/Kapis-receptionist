# ADR-004: Account Security (Sprint 2.3)

**Status:** Accepted
**Date:** 2026-07-22
**Milestone:** 2 — Authentication, follow-up "Sprint 2.3" (docs/adr/ADR-003-core-authentication.md's own recommendation)
**Related:** docs/AUTHENTICATION.md, docs/API_SPECIFICATION.md §4, docs/adr/ADR-002-authentication-schema.md, docs/adr/ADR-003-core-authentication.md

---

## Decision

Implement exactly eight capabilities on top of the Core Authentication sprint (ADR-003): email verification, resend verification, password reset, password reset confirmation, login attempt tracking, temporary account lockout, security event logging (extended), and refresh-token revocation on password reset. Explicitly excluded, per this sprint's charter: RBAC/`RolesGuard` enforcement, Google OAuth, MFA/WebAuthn, and multi-tenancy business logic — all remain Milestone 3+ scope, consistent with ADR-003's own list of what it left open.

This is a **narrower** scope than ADR-003's "recommended Sprint 2.3" note, which also named Google OAuth, invitation-acceptance, and `Users` CRUD as open items — those are intentionally deferred again here, not silently forgotten.

## Context

ADR-003 shipped Register/Login/Logout/Refresh/Me, deliberately excluding everything this ADR now closes. `User.isEmailVerified`, `EmailVerification`, and `PasswordReset` tables already existed in `schema.prisma` (added by ADR-002) but were completely unused — no new migration was needed for either flow. No email-sending capability existed at all, and no login-attempt-tracking/lockout mechanism existed.

## Key Design Decisions

| Decision | Summary | Rationale |
|---|---|---|
| Minimal `Notifications` module, not the full Milestone 9 build-out | A single `NotificationsService.sendEmail()` using `nodemailer` over SMTP, with a log-only fallback when `SMTP_HOST` is unset. | Matches SYSTEM_ARCHITECTURE.md §3.2's documented `Notifications` public API exactly, pulled forward only as far as this sprint's two email flows need — no `NotificationTemplate`/`NotificationLog` tables, which stay Milestone 9 scope. The log-only fallback keeps local dev/CI working with zero mail infrastructure, mirroring `SecurityEventService`'s own log-first design. |
| Email verification / password reset tokens are plain SHA-256, not HMAC-peppered like the refresh token | `TokenService` gained generic `generateOpaqueToken()`/`hashOpaqueToken()` helpers, reused by both flows. | These tokens are short-lived (hours) and single-use, unlike the refresh token's 30-day revocable-session model that specifically motivated a separate pepper secret (AUTHENTICATION.md §4.2). Reusing that same peppering model here would add a secret dependency with no corresponding security need. |
| Login-attempt tracking and lockout live in Redis, not a new Postgres table | `LoginAttemptService`, keyed by normalized email, using `RedisService` directly. | This state is ephemeral and rolling-window by nature (DATABASE_DESIGN.md §1.6), and SYSTEM_ARCHITECTURE.md §11.3 already designates Redis as the platform's home for exactly this kind of counter/rate-limit state — a new durable table would be schema weight with no lasting value. |
| Lockout is keyed by email, not user ID | `getLockoutStatus`/`recordFailure`/`recordSuccess` all take the normalized email string. | Keying by user ID would require resolving the account first, silently revealing (via timing/behavior) whether an email belongs to an existing account — the same enumeration-resistance principle `AuthService.login`'s generic `INVALID_CREDENTIALS` response already applies is extended here. |
| `EMAIL_NOT_VERIFIED` login enforcement is now switched on | AUTHENTICATION.md §7 flagged this as a "known, temporary gap to close when the email-verification sprint lands" — this is that sprint. | Closes the exact gap ADR-003 documented rather than leaving it open indefinitely once the prerequisite (email verification) exists. |
| A failed-login attempt is recorded for `INVALID_CREDENTIALS` (unknown account or wrong password) but **not** for `EMAIL_NOT_VERIFIED`/`ACCOUNT_DEACTIVATED` | Only genuine credential-guessing attempts count toward lockout. | A correctly-authenticated-but-unverified user retrying their own correct password shouldn't be able to lock themselves out — that failure mode has nothing to do with credential-guessing, the threat lockout exists to mitigate. |
| `resendVerification`/`forgotPassword` are enumeration-safe: identical response whether or not the account exists (or is already verified) | Mirrors the already-documented `forgot-password` non-enumeration contract (API_SPECIFICATION.md §4) and extends the same principle to the new `resend-verification` endpoint. | A different response for "no such account" vs. "already verified" vs. "sent" would leak account existence/state through timing-independent means (the response body itself), the exact failure mode the existing `forgot-password` endpoint was already designed to avoid. |
| Superseding a verification/reset token hard-deletes the prior row rather than soft-revoking it | `invalidateActiveForUser()` on both repository ports issues a `deleteMany` scoped to unconsumed rows. | Consistent with DATABASE_DESIGN.md §1.6: an unconsumed, superseded single-use token carries no long-term business meaning once replaced — this is the same ephemeral-table treatment already applied to `UserSession`-adjacent tables, not a new pattern. |
| Password reset revokes **every** refresh token for the user | `AuthService.resetPassword` calls the existing `SessionService.revokeAllForUser` (previously only invoked by reuse-detection). | Explicit sprint requirement, and exactly the behavior SYSTEM_ARCHITECTURE.md §7.6 already documented ("all active sessions/refresh tokens... invalidated on successful password reset") but that ADR-003's narrower scope hadn't yet had a reset flow to wire it to. |
| `POST /auth/resend-verification` is a new endpoint, added beyond API_SPECIFICATION.md's existing documented set | The sprint's "Resend verification" requirement has no literal existing endpoint to implement it against. | A judgment call, confirmed with the requester before implementation: the endpoint is documented in this same change (API_SPECIFICATION.md §4 amendment) rather than silently introduced. |
| `403 ACCOUNT_LOCKED` is a new error code | No existing code fit "too many failed attempts, temporarily blocked." | Follows the same pattern as the existing `403 ACCOUNT_DEACTIVATED` — a distinguishable, documented state rather than a generic `401`. |

## Alternatives Considered

1. **Enforce lockout by user ID once the account is known to exist, generic-by-email only for unknown accounts.** Rejected — a hybrid keying scheme is more complex to reason about and still leaks existence through the seam between the two paths (an unknown-email path that never locks vs. a known-email path that does, observable via repeated-attempt behavior over time).
2. **Add a durable `LoginAttempt`/`AccountLockout` Postgres table now, ahead of Milestone 9.** Rejected — this state has no auditing/reporting value once it expires (unlike `AuditLog`, which this project deliberately keeps separate, PRISMA_SCHEMA.md §11), and Redis is already the documented home for this exact kind of state.
3. **Build the full Milestone 9 `NotificationTemplate`/`NotificationLog` system now, since email-sending is needed anyway.** Rejected as disproportionate — this sprint needs exactly two hardcoded email bodies; templating/logging infrastructure for arbitrary future notification types is Milestone 9's explicit, separately-scoped deliverable (IMPLEMENTATION_ROADMAP.md §5, row 15).

## Consequences

- ADR-003's "known, temporary gap" (`EMAIL_NOT_VERIFIED` not enforced) is now closed; `login.integration-spec.ts` and `auth.service.spec.ts` both assert the new behavior explicitly so it can't silently regress.
- `test-app.factory.ts`'s `seedOwner` helper now creates its seeded user pre-verified (`isEmailVerified: true`) — it exists specifically to bypass `/auth/register` for specs testing other endpoints (login, logout, refresh, me), and those specs would otherwise all break on this sprint's new enforcement for a reason unrelated to what they're testing.
- The `Notifications` module now exists as a real (if minimal) NestJS module, ahead of Milestone 9's full build-out — Milestone 9 extends it (`NotificationTemplate`, `NotificationLog`, additional notification types) rather than creating it from scratch.
- `TokenService` now hosts two independent token-hashing schemes (HMAC-peppered for refresh tokens, plain SHA-256 for verification/reset tokens) — both documented in the same file so a future reader isn't left wondering why the module doesn't use one scheme uniformly.
- A CSRF double-submit token and Google OAuth remain open items from ADR-003, unaffected by this sprint.

## File Manifest

**Backend:** `src/modules/notifications/**` (new module); `src/modules/auth/domain/{entities,ports}/{email-verification,password-reset}*.ts` (new); `src/modules/auth/infrastructure/prisma-{email-verification,password-reset}.repository.ts` (new); `src/modules/auth/application/{auth,token,login-attempt,security-event}.service.ts` (edited/new); `src/modules/auth/application/exceptions/auth.exceptions.ts` (edited); `src/modules/auth/interface/{auth.controller.ts, dto/{verify-email,resend-verification,forgot-password,reset-password}.dto.ts}` (edited/new); `src/modules/auth/auth.module.ts` (edited); `src/modules/auth/domain/ports/user-repository.port.ts` + `src/modules/auth/infrastructure/prisma-user.repository.ts` (edited); `src/common/constants/auth.constants.ts` (edited); `src/config/{configuration,env.validation,config.module}.ts` (edited); `.env.example` (edited); `test/unit/auth/**`, `test/unit/notifications/**`, `test/integration/auth/{verify-email,resend-verification,forgot-password,reset-password,login-lockout}.integration-spec.ts` (new), `test/integration/auth/login.integration-spec.ts` + `test/integration/support/test-app.factory.ts` (edited).

**Frontend:** `src/app/core/auth/auth-api.service.ts` (edited); `src/app/features/auth/pages/{verify-email-page,forgot-password-page,reset-password-page}/**` (new); `src/app/features/auth/pages/login-page/**` (edited); `src/app/features/auth/auth.routes.ts` (edited).

**Docs:** this file; docs/AUTHENTICATION.md; docs/API_SPECIFICATION.md (amendments); docs/IMPLEMENTATION_ROADMAP.md (Sprint 2.3 marked complete); docs/DECISIONS.md (index entry); CHANGELOG.md.
