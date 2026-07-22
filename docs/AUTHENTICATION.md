# AUTHENTICATION.md

## Core Authentication — Implementation Reference

**Document Status:** As-Built
**Milestone:** 2 — Authentication (Core Authentication sprint + Sprint 2.3 "Account Security" follow-up)
**Depends on:** SYSTEM_ARCHITECTURE.md §7–9, PRISMA_SCHEMA.md §3, API_SPECIFICATION.md §4, FRONTEND_ARCHITECTURE.md §5, docs/adr/ADR-002-authentication-schema.md, docs/adr/ADR-003-core-authentication.md, docs/adr/ADR-004-account-security.md
**Scope:** What was actually built across both sprints — Register, Login, Logout, Refresh, Get Current User, Email Verification, Resend Verification, Password Reset, Password Reset Confirmation, Login Attempt Tracking, Temporary Account Lockout — and every security decision behind it. Google OAuth and RBAC authorization are explicitly **not** covered here; see "Out of Scope" below.

---

## 1. Endpoints Implemented

| Endpoint | Auth | Rate Limit Tier |
|---|---|---|
| `POST /api/v1/auth/register` | Public | Public-Sensitive (10/min/IP) |
| `POST /api/v1/auth/login` | Public | Public-Sensitive (10/min/IP) |
| `POST /api/v1/auth/logout` | Bearer JWT | Standard-Authenticated (120/min) |
| `POST /api/v1/auth/refresh` | Refresh-token cookie | Standard-Authenticated (120/min, per-IP — see §5) |
| `GET /api/v1/auth/me` | Bearer JWT | Standard-Authenticated (120/min) |
| `POST /api/v1/auth/verify-email` | Public (token is the credential) | Public-Sensitive (10/min/IP) |
| `POST /api/v1/auth/resend-verification` | Public | Public-Sensitive (10/min/IP) |
| `POST /api/v1/auth/forgot-password` | Public | Public-Sensitive (10/min/IP) |
| `POST /api/v1/auth/reset-password` | Public (token is the credential) | Public-Sensitive (10/min/IP) |

Full request/response contracts: API_SPECIFICATION.md §4 (unchanged except the amendments noted in §7 below and the new `resend-verification` endpoint documented there).

---

## 2. Password Hashing — Argon2id

**Library:** `argon2` (node-argon2, native bindings).

**Parameters** (`backend/src/common/constants/auth.constants.ts`, `ARGON2ID_OPTIONS`):

| Parameter | Value | |
|---|---|---|
| `type` | `argon2id` | Hybrid resistance to both GPU/ASIC cracking (like argon2i) and side-channel attacks (like argon2d) — OWASP's recommended variant for password storage. |
| `memoryCost` | `65536` KiB (64 MiB) | Above OWASP's stated minimum (19 MiB). Justified: this runs on a dedicated multi-core Hetzner VPS (not a shared/serverless environment with tight memory budgets), and register/login are low-frequency-per-user operations, so the extra cost is imperceptible to UX but meaningfully raises the cost of an offline brute-force attempt against a stolen hash. |
| `timeCost` | `3` iterations | Paired with the memory cost above, keeps single-hash latency in the tens-of-milliseconds range on typical server hardware — deliberately slow enough to blunt brute-forcing, fast enough not to be a UX problem. |
| `parallelism` | `4` | Matches a typical container's allotted vCPUs; higher parallelism at a fixed memory cost doesn't materially weaken resistance (memory cost is the dominant cost driver for Argon2), so this is tuned for throughput, not a security trade-off. |
| `hashLength` | `32` bytes | Standard output length; no reason to deviate. |

The full parameter set is embedded in the resulting hash string (`$argon2id$v=19$m=65536,t=3,p=4$...`), so hashes remain verifiable even if the constants are tuned differently in the future — `argon2.verify()` reads the parameters back out of the hash itself.

**Password validation rules** (`RegisterDto`, mirrored client-side in `passwordStrengthValidator`): minimum 8 characters, maximum 128 (a defensive cap — Argon2's cost scales with input size, and 128 characters is far beyond any legitimate password while still bounding worst-case hashing cost from a malicious oversized payload), at least one uppercase letter, at least one digit. Exactly API_SPECIFICATION.md §4's documented rule — no additions.

---

## 3. JWT — Access Tokens

- **Algorithm:** HS256 (via `@nestjs/jwt`), signed with `JWT_ACCESS_SECRET`.
- **Expiry:** 15 minutes (`900` seconds).
- **Claims:** `sub` (userId), `email`, `tenantId`, `roles` (array — `User.roles` is a many-to-many via `UserRole`, PRISMA_SCHEMA.md §3.1).
- **Transport:** `Authorization: Bearer <token>` header only — never a cookie, never `localStorage` on the frontend (held in an Angular signal, in memory only).
- **Verification:** `JwtAuthGuard` (`modules/auth/interface/guards/jwt-auth.guard.ts`) — a hand-rolled guard rather than `@nestjs/passport` + `passport-jwt`. This module has exactly one token type to verify; a full Passport strategy would be an unused abstraction. Future guards (`RolesGuard`/`TenantScopedGuard`, Milestone 3) compose on top of the same `request.user` shape this guard sets.

---

## 4. Refresh Tokens

### 4.1 Why the refresh token is not a JWT

The refresh token is a **512-bit opaque random string** (`crypto.randomBytes(64)`, base64url-encoded), not a signed JWT. This is a deliberate, security-motivated choice:

- A JWT refresh token would be verifiable **offline** by anyone holding the signing secret — exactly the property we don't want for a credential that must be individually revocable, rotatable, and reuse-detectable server-side at any moment.
- An opaque token forces every use through a database lookup, which is precisely the control point rotation/revocation/reuse-detection need.

### 4.2 "Separate secrets," applied correctly

The task requirement was "use separate secrets" for access and refresh tokens. Since the refresh token isn't a JWT, there's no second *signing* key — instead:

- `JWT_ACCESS_SECRET` signs/verifies the access-token JWT.
- `JWT_REFRESH_SECRET` is an **HMAC-SHA256 pepper** applied to the raw refresh token before it's hashed and stored (`TokenService.hashRefreshToken`). The raw token is never persisted anywhere — only `HMAC-SHA256(rawToken, JWT_REFRESH_SECRET)` is stored, in `RefreshToken.refreshTokenHash`.

This still satisfies the actual security property "use separate secrets" is protecting: compromise of one secret does not compromise the other. It does so with a design that's arguably stronger than a shared-secret JWT approach, since even full database compromise doesn't yield usable credentials — the pepper is never stored alongside the hash.

### 4.3 Cookie

`Set-Cookie: refresh_token=<raw>; HttpOnly; Secure (production only); SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000`

- **`HttpOnly`** — inaccessible to JavaScript, the primary XSS mitigation for this credential (SYSTEM_ARCHITECTURE.md §7.2).
- **`SameSite=Strict`** — blocks the cookie from being sent on cross-site requests, the primary CSRF mitigation for this credential (SYSTEM_ARCHITECTURE.md §9.10). A CSRF double-submit token on top of this was considered and **explicitly deferred** (see §8) — `SameSite=Strict` + `HttpOnly` is the non-negotiable primary control; the double-submit token is documented defense-in-depth, not yet implemented.
- **`Path=/api/v1/auth`** — least-privilege: the browser only ever sends this cookie to the five auth endpoints, never to every other API call.
- **`Max-Age=2592000`** (30 days) — the task-specified refresh token lifetime.

### 4.4 Rotation

Every successful `/auth/refresh` call:
1. Looks up the presented token by `HMAC-SHA256(rawToken, JWT_REFRESH_SECRET)`.
2. Issues a **new** `RefreshToken` row (new opaque token, new 30-day expiry).
3. Marks the **old** row `revokedAt = now()` and `replacedBySessionId = <new row's id>` — the old row is never deleted, only linked forward. This chain is what reuse detection (§4.5) depends on.
4. Returns a new access token and sets a new `Set-Cookie` with the new raw token.

### 4.5 Reuse Detection

**The key design decision:** `replacedBySessionId` being set is what distinguishes a token that's dead *because it was rotated* from a token that's dead *because it was logged out*. Both cases set `revokedAt`, but only rotation sets `replacedBySessionId`.

- **A token revoked by rotation, replayed again** (`revokedAt` set **and** `replacedBySessionId` set): this is unambiguous proof of theft — the legitimate client already received and is using the *new* token, so anyone presenting the *old* one must have captured it separately. Response: revoke **every** currently-active `RefreshToken` for that user (all-device kill-switch) and return `401 REFRESH_TOKEN_REUSE_DETECTED`.
- **A token revoked by plain logout, replayed again** (`revokedAt` set, `replacedBySessionId` **null**): this is just a dead session, not evidence of theft. Response: plain `401 INVALID_OR_EXPIRED_REFRESH_TOKEN`, **no** mass revocation.

This distinction was found and fixed during manual verification of this sprint's implementation: an earlier version treated *any* revoked-token replay as reuse, which meant logging out on one device would spuriously sign the user out of every other device the next time that first device's (now-dead, but legitimately-so) cookie was presented. `test/unit/auth/session.service.spec.ts` and `test/integration/auth/logout.integration-spec.ts` both assert this distinction explicitly so it can't silently regress.

### 4.6 Single-Device vs. All-Device Logout

- **Single-device** (`POST /auth/logout`, the only logout endpoint implemented): revokes exactly the session whose cookie was presented. Idempotent — logging out an already-revoked session is a safe no-op, `200` either way (matches API_SPECIFICATION.md §4).
- **All-device**: not exposed as a separate user-triggered endpoint this sprint (no "log out everywhere" UI was in scope — that would live on the Profile page, itself out of scope). `SessionService.revokeAllForUser()` exists as a reusable method and is currently invoked exactly once: automatically, as the reuse-detection security response (§4.5). It's positioned to back a future "sign out of all devices" button without new backend work.

---

## 5. Rate Limiting

Implemented via `@nestjs/throttler`, registered inside `AuthModule` (not globally) so these limits stay scoped to `/auth/*` only.

| Endpoint | Tier | Limit |
|---|---|---|
| `POST /auth/register` | Public-Sensitive | 10 req/min per IP |
| `POST /auth/login` | Public-Sensitive | 10 req/min per IP |
| `POST /auth/refresh` | Standard-Authenticated | 120 req/min |
| `POST /auth/logout` | Standard-Authenticated | 120 req/min |
| `GET /auth/me` | Standard-Authenticated | 120 req/min |

Exactly API_SPECIFICATION.md §2.10's documented tiers. One documented simplification: `/auth/refresh`'s Standard-Authenticated tier is specified there as "keyed by session, not user" — this implementation keys it by IP (the throttler's default tracker) rather than by the refresh-token session specifically. True per-session tracking would require parsing the refresh cookie before the guard runs, added complexity not clearly justified yet at this scale. Flagged here as a known, deliberate simplification rather than a silent gap.

---

## 6. SecurityEventService

Every register/login-success/login-failure/logout/refresh-success/refresh-failure/reuse-detected event — plus, as of Sprint 2.3, email-verification-sent/email-verified/password-reset-requested/password-reset-success/account-locked/login-blocked-locked-out — is recorded as a structured, tagged log line (`SecurityEventService.record`), not written to a new database table. `AuditLog` is explicit Milestone 9 scope (PRISMA_SCHEMA.md §11); adding it now would be exactly the kind of forward-reference this project's incremental-migration discipline (ADR-001, ADR-002) exists to avoid. The event shape (`type`, `userId`, `tenantId`, `email`, `ipAddress`, `userAgent`, plus event-specific fields) is stable and designed to be trivially replayable into a real persisted table once Milestone 9 builds one.

---

## 6a. Account Security (Sprint 2.3, docs/adr/ADR-004-account-security.md)

### 6a.1 Notifications Module

A minimal `NotificationsService.sendEmail(to, subject, html, text)` (new `src/modules/notifications/` module) — `nodemailer` over SMTP, configured via `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`/`MAIL_FROM`. If `SMTP_HOST` is unset (local dev, CI), the email is logged via Pino instead of sent — every environment works without real mail infrastructure. This is the single capability SYSTEM_ARCHITECTURE.md §3.2's `Notifications` module documents as `sendEmail`; templated/logged notifications (`NotificationTemplate`, `NotificationLog`) remain Milestone 9 scope.

### 6a.2 Verification / Reset Token Primitive

`TokenService.generateOpaqueToken()` (32 random bytes, base64url) + `hashOpaqueToken()` (plain SHA-256, no pepper) — a second, deliberately simpler token scheme alongside the refresh token's HMAC-peppered one. These tokens are short-lived and single-use (hours, not the refresh token's 30 days), so they don't carry the same revocation/reuse-detection requirements that motivated a separate pepper secret for refresh tokens (§4.2). Shared by both email verification and password reset.

### 6a.3 Email Verification / Resend

- `POST /auth/register` now creates an `EmailVerification` row and sends a verification email (`{FRONTEND_URL}/auth/verify-email/{token}`); the response `message` is `"Verification email sent."` again — accurate now that this is true, reverting the Sprint 2 amendment noted in §7.
- `POST /auth/verify-email` looks up the token by hash, checks `verifiedAt IS NULL` and `expiresAt > now()`, then sets `EmailVerification.verifiedAt` and `User.isEmailVerified = true`. Single-use, matching `PasswordReset`'s mechanics.
- `POST /auth/resend-verification` — **new endpoint**, not in API_SPECIFICATION.md's original Section 4 (added as an amendment in this same change) — is enumeration-safe: an identical generic response whether the account doesn't exist, is already verified, or a fresh token was actually issued. A resend invalidates (hard-deletes) any prior unconsumed token for that user before issuing a new one.
- `POST /auth/login` now enforces `403 EMAIL_NOT_VERIFIED` — closing the gap §7/§8 previously documented as deferred.

### 6a.4 Password Reset / Reset Confirmation

- `POST /auth/forgot-password` — already documented, now implemented — is enumeration-safe (unchanged contract). Issuing a new token hard-deletes any prior unconsumed one for that user.
- `POST /auth/reset-password` validates the token (hash lookup, unused, unexpired), updates `User.passwordHash`, marks the token used, and — per this sprint's explicit requirement, matching SYSTEM_ARCHITECTURE.md §7.6 — calls `SessionService.revokeAllForUser`, revoking every refresh token/session for that user. This is the same all-device revoke mechanism reuse-detection already used (§4.5), now with a second caller.

### 6a.5 Login Attempt Tracking & Temporary Lockout

`LoginAttemptService` (new), Redis-backed (`RedisService`, already wired for the platform per SYSTEM_ARCHITECTURE.md §11.3) — no new Postgres table, since this state is rolling-window/ephemeral by nature (DATABASE_DESIGN.md §1.6).

- Keyed by **normalized email**, not user ID — deliberately, so lockout behavior itself never reveals whether an account exists (the same enumeration-resistance principle already applied to `INVALID_CREDENTIALS`, extended here).
- Defaults (env-configurable): 5 failed attempts within a 15-minute window (`LOGIN_ATTEMPT_MAX`/`LOGIN_ATTEMPT_WINDOW_SECONDS`) trigger a 15-minute lockout (`LOGIN_LOCKOUT_SECONDS`), returning `403 ACCOUNT_LOCKED` — a new error code, following the same pattern as the existing `403 ACCOUNT_DEACTIVATED`.
- A failed attempt is recorded for `INVALID_CREDENTIALS` (unknown account or wrong password) only — **not** for a correct password against an unverified or deactivated account, since those aren't credential-guessing failures and shouldn't count toward lockout.
- A successful login clears both the attempt counter and any lockout key for that email.
- The lockout check runs before the user lookup, so a locked-out email is rejected without ever querying the database for that account.

---

## 7. Deviations from the Pre-Existing Documented Contract

**As of the Core Authentication sprint** (ADR-003), two small, deliberate amendments were made to API_SPECIFICATION.md/FRONTEND_ARCHITECTURE.md, because that sprint's narrower scope (register/login/logout/refresh/me only) made the originally-documented behavior impossible or misleading as written:

1. **`POST /auth/register`'s response `message`** was documented as `"Verification email sent."`. No email was sent that sprint, so it was changed to `"Account created. Please log in."`. **As of Sprint 2.3, this reverts**: a verification email is genuinely sent now, so the response `message` is `"Verification email sent."` again, matching the original documented contract.
2. **Register does not establish a session.** Unchanged by Sprint 2.3 — this was already the literal, documented contract (no `accessToken` in the success response), and still holds (`/app/onboarding` remains Milestone 3 scope). The frontend still redirects to `/auth/login` with a `?registered=true` banner; the banner copy now mentions checking email for the verification link, since that's accurate again.

**As of Sprint 2.3, login now enforces `403 EMAIL_NOT_VERIFIED`** (§6a.3) — the gap the Core Authentication sprint left open (previously documented in this section as "a known, temporary gap") is closed.

---

## 8. Explicitly Out of Scope (Deferred, Not Forgotten)

- **Google OAuth** — `POST /auth/google` and the frontend callback route.
- **RBAC authorization enforcement** — `RolesGuard`/`PermissionGuard`/`TenantScopedGuard` (Milestone 3, SYSTEM_ARCHITECTURE.md §7.3–7.4). `User.roles` is populated and carried in the JWT this sprint, but nothing yet *checks* it — every authenticated user can currently reach every authenticated endpoint regardless of role, exactly as `@nestjs/throttler`-guarded-but-not-role-guarded implies. This is safe only because no role-sensitive endpoints exist yet in this sprint's scope.
- **CSRF double-submit token** on `/auth/refresh` (SYSTEM_ARCHITECTURE.md §9.10) — deferred; `SameSite=Strict` + `HttpOnly` is the implemented primary control.
- **`Users`/`Tenants` modules** as their own NestJS modules — `User`/`Tenant` Prisma access for this sprint lives inside `AuthModule`'s own `infrastructure/` layer (repositories scoped to what Auth needs), not a separate public module, following the same minimal-forward-provisioning precedent ADR-002 already established for the `Tenant` table itself. The real `Users` (staff CRUD, invitations) and `Tenants` (`TenantSettings`, `TenantFeature`, atomic register-provisions-a-tenant-with-`TenantSettings`+`Subscription` transaction) modules remain Milestone 3 scope.

---

## 9. Environment Variables

Added to `backend/.env.example` (see file for the full block):

| Variable | Purpose |
|---|---|
| `JWT_ACCESS_SECRET` | Signs/verifies access-token JWTs. Min 32 chars, generate via `openssl rand -base64 48`. |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime, `jsonwebtoken`-style string (default `15m`). |
| `JWT_ACCESS_EXPIRES_IN_SECONDS` | Same value in seconds, used for the API's `expiresIn` response field and token signing (default `900`). |
| `JWT_REFRESH_SECRET` | HMAC pepper for refresh-token hashing — never a JWT signing key. Min 32 chars, independently generated from `JWT_ACCESS_SECRET`. |
| `JWT_REFRESH_EXPIRES_IN_SECONDS` | Refresh token lifetime in seconds (default `2592000` = 30 days). |

Both secrets are validated at bootstrap (`env.validation.ts`) — a missing or too-short secret fails fast at startup, not on first request (SYSTEM_ARCHITECTURE.md §10.6).

**Sprint 2.3 additions** (all optional, sensible defaults — see `.env.example`):

| Variable | Purpose |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | SMTP transport for `NotificationsService`. Unset `SMTP_HOST` → emails are logged, not sent (dev/CI-friendly). |
| `MAIL_FROM` | `From` address for outbound email. |
| `FRONTEND_URL` | Base URL used to build verification/reset links (`{FRONTEND_URL}/auth/verify-email/{token}`, etc). |
| `LOGIN_ATTEMPT_MAX` / `LOGIN_ATTEMPT_WINDOW_SECONDS` / `LOGIN_LOCKOUT_SECONDS` | Login-attempt-tracking thresholds (defaults: 5 attempts / 900s window / 900s lockout). |
| `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS` / `PASSWORD_RESET_EXPIRES_IN_SECONDS` | Token lifetimes (defaults: 86400 / 3600). |

---

## 10. Frontend Architecture Summary

Per FRONTEND_ARCHITECTURE.md §5, implemented this sprint:

- `core/auth/auth-api.service.ts` — thin typed HTTP wrapper, no state.
- `core/auth/auth-state.service.ts` — the signals-based session store (`currentUser`, `currentTenant`, `accessToken`, computed `isAuthenticated`). Access token held in memory only, never `localStorage`.
- `core/auth/session.service.ts` — bootstrap silent-refresh (`provideAppInitializer` in `app.config.ts`) and the single-in-flight-refresh coordination `AuthInterceptor` shares on a `401`.
- `core/interceptors/auth.interceptor.ts` — attaches the bearer token, retries once through a coordinated refresh on `401`, redirects to `/auth/login` with `returnUrl` on refresh failure.
- `core/guards/auth.guard.ts` / `guest-only.guard.ts` — functional guards reading `AuthStateService` signals only, never making their own API call.
- `features/auth/pages/{login-page,register-page}` — Reactive Forms, client-side validation mirroring the server's rules, inline error handling keyed off `ApiError.code`.
- `features/auth/pages/{verify-email-page,forgot-password-page,reset-password-page}` (Sprint 2.3) — `verify-email-page` reads `:token` on load with no form and no guard (FRONTEND_ARCHITECTURE.md §5.4); `forgot-password-page`/`reset-password-page` mirror login/register's form conventions and are `guestOnlyGuard`-protected. `login-page` gained a "Forgot password?" link and inline `EMAIL_NOT_VERIFIED`/`ACCOUNT_LOCKED` handling, including a one-click resend-verification action.
- `layouts/auth-layout`, `layouts/dashboard-layout` — the latter deliberately minimal this sprint (header identity + logout only); the full sidebar/nav chrome (FRONTEND_ARCHITECTURE.md §4.2) is built out once Milestone 3+ gives it real destinations.

Not built this sprint (per FRONTEND_ARCHITECTURE.md's own component-library note): the shared `Button`/`Input` primitive component library (§7) — the auth forms use plain, accessible native HTML elements styled directly with Tailwind. That library is a larger, separate design-system undertaking; building it wasn't required to ship a working, accessible auth UI, and every future feature is free to introduce it without this sprint's pages needing rework beyond a styling pass.

---

## 11. Files

See docs/adr/ADR-003-core-authentication.md for the Core Authentication sprint's file manifest, and docs/adr/ADR-004-account-security.md for Sprint 2.3's — both include the sprint-scope rationale.
