# Production Readiness Checklist

**Status:** Audit as of 2026-07-25, against the codebase at the head of `main` (post–Milestone 9: Auth, Multi-tenancy, Salon Management, Employees, Services, Customers, Scheduling, WhatsApp, AI, Billing all functionally complete).

**How to read this document:** every claim below is grounded in a specific file — reviewed as of the audit date, not inferred from architecture docs. `docs/SYSTEM_ARCHITECTURE.md` is marked "Draft for Approval" and describes several controls (Helmet, HSTS, CSP, TLS, S3 backups, a `docker-compose.prod.yml`) that **do not exist in the codebase yet** — where it conflicts with what's actually implemented, this document defers to the code and to `docs/SECURITY.md` ("As-Built"), not to the architecture draft. Legend: **✔ Complete**, **⚠ Missing** (gap, not necessarily blocking), **❌ Required before production** (blocking).

---

## 1. Environment Variables

All variables are defined in `backend/.env.example` and fail-fast validated at boot in `backend/src/config/env.validation.ts` (`validateSync`, throws before `app.listen()` on any missing/malformed **required** var). Frontend and infrastructure variables are separate — see their own subsections.

### 1.1 Backend — Application

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | No | `development` | enum: development / test / staging / production |
| `PORT` | No | `3000` | 1–65535 |
| `APP_NAME` | No | — | |
| `CORS_ORIGIN` | No | `http://localhost:4200` | **Single origin string, not URL-validated, no array support** — must be set to the real frontend origin in production; see §5.2 |
| `LOG_LEVEL` | No | `info` | enum: fatal/error/warn/info/debug/trace |

### 1.2 Postgres / Database

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Plain string, not URL-validated by the app itself — validate manually |

### 1.3 Redis

| Variable | Required | Notes |
|---|---|---|
| `REDIS_URL` | **Yes** | `@IsUrl`, restricted to `redis`/`rediss` protocols |

Used for: cache, distributed booking locks, idempotency keys, and (separately) the BullMQ queue connection (`whatsapp-inbound`, `whatsapp-outbound`, `stripe-webhook` queues — see §5.10).

### 1.4 JWT / Cookies

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | **Yes** | — | `@MinLength(32)`. Signs access tokens (HS256). |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | |
| `JWT_ACCESS_EXPIRES_IN_SECONDS` | No | `900` | |
| `JWT_REFRESH_SECRET` | **Yes** | — | `@MinLength(32)`. **Independent** secret — refresh tokens are opaque (not JWTs), this peppers their server-side hash. Never reuse `JWT_ACCESS_SECRET`'s value. |
| `JWT_REFRESH_EXPIRES_IN_SECONDS` | No | `2592000` (30d) | |

Refresh-token cookie (not an env var, but production-relevant): name `refresh_token`, `httpOnly: true`, `sameSite: 'strict'`, `path: /api/v1/auth`, `secure: NODE_ENV==='production'`. **`secure` is computed from `NODE_ENV`** — you must set `NODE_ENV=production` for the cookie to be marked Secure; see §5.6.

### 1.5 SMTP (all optional — unset means dev-mode "log instead of send")

| Variable | Required in prod | Default |
|---|---|---|
| `SMTP_HOST` | **Yes, in practice** — see §2.7 | unset |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | — |
| `SMTP_PASS` | No | — |
| `MAIL_FROM` | No | `no-reply@kapis-receptionist.example.com` — **must be changed** |
| `FRONTEND_URL` | No | `http://localhost:4200` — **must be changed**, used to build verification/reset links |

### 1.6 Login / Lockout / Token Lifetimes

| Variable | Default |
|---|---|
| `LOGIN_ATTEMPT_MAX` | 5 |
| `LOGIN_ATTEMPT_WINDOW_SECONDS` | 900 |
| `LOGIN_LOCKOUT_SECONDS` | 900 |
| `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS` | 86400 |
| `PASSWORD_RESET_EXPIRES_IN_SECONDS` | 3600 |
| `RBAC_PERMISSION_CACHE_TTL_SECONDS` | 3600 |
| `TENANT_INVITATION_EXPIRES_IN_SECONDS` | 604800 (7d) — present in `env.validation.ts` only, missing from `.env.example`; add it there |

### 1.7 WhatsApp Cloud API

| Variable | Required | Notes |
|---|---|---|
| `WHATSAPP_APP_SECRET` | **Yes** | `@MinLength(32)`. Signs Meta's `X-Hub-Signature-256` — verifies inbound webhooks. |
| `WHATSAPP_VERIFY_TOKEN` | **Yes** | `@MinLength(8)`. Webhook subscription handshake (`GET /webhooks/whatsapp`). |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | **Yes** | `@MinLength(44)`, must base64-decode to exactly 32 bytes. AES-256-GCM key encrypting `WhatsAppAccount.accessTokenEncrypted`. |
| `WHATSAPP_GRAPH_API_BASE_URL` | No | default `https://graph.facebook.com/v21.0` |

### 1.8 OpenAI / AI

| Variable | Required | Default |
|---|---|---|
| `OPENAI_API_KEY` | **Yes** | `@MinLength(20)` |
| `OPENAI_MODEL` | No | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | No | — |
| `AI_REQUEST_TIMEOUT_MS` | No | 8000 |
| `AI_MAX_RETRIES` | No | 2 |
| `AI_MAX_HISTORY_MESSAGES` | No | 20 |
| `AI_INTERNAL_API_KEY` | **Yes** | `@MinLength(32)`. Shared secret on `X-Internal-Api-Key`, guards `POST /ai/tools/*` and internal-mode `POST /ai/chat`. |
| `AI_RATE_LIMIT_PER_MINUTE` | No | 30 |

### 1.9 Stripe / Billing

| Variable | Required | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | **Yes** | `@MinLength(8)` — use a **live** key in production, not test |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | `@MinLength(8)` — the live webhook endpoint's signing secret, distinct from any test-mode one |
| `STRIPE_PUBLISHABLE_KEY` | No | unused server-side; only needed if a client-side Stripe.js integration is added later |
| `BILLING_CHECKOUT_SUCCESS_URL` | **Yes** | `@IsUrl` — must point at the real production frontend domain |
| `BILLING_CHECKOUT_CANCEL_URL` | **Yes** | same |
| `BILLING_PORTAL_RETURN_URL` | **Yes** | same |

### 1.10 Frontend (Angular)

Not covered by `backend/env.validation.ts`. Check `frontend/src/environments/` for build-time config (API base URL, etc.) — **audit action item**: confirm the production Angular build points its API base URL at the real backend domain, not `localhost:3000`.

### 1.11 Infrastructure / Docker Compose

`infrastructure/env/.env.example` — Postgres credential overrides (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) consumed by `docker-compose.yml`. Its own comment states staging/production credentials are never committed — correct, keep doing this.

### 1.12 Not present anywhere (gaps, see §7 for context)

No `SENTRY_DSN`/APM variable, no S3/object-storage credentials, no HSTS/TLS-related variable, no Google OAuth client ID/secret (feature not implemented).

---

## 2. Third-Party Accounts Required Before Launch

| Account | Why | Where to get it | Keys needed | Configured where |
|---|---|---|---|---|
| **OpenAI** | Powers the AI receptionist (chat completions, tool calling) | platform.openai.com → API keys | `OPENAI_API_KEY` | `backend/.env` |
| **Meta Developer Account** | Required to create/manage a WhatsApp Business App | developers.facebook.com | App ID/Secret (`WHATSAPP_APP_SECRET`) | `backend/.env` |
| **WhatsApp Business Platform (Cloud API)** | The actual messaging channel | Meta Business Manager, linked to the Meta Developer app | Phone Number ID, Business Account ID, permanent access token (stored encrypted per-tenant via the app's own WhatsApp connection flow, not a global env var), `WHATSAPP_VERIFY_TOKEN` (you choose this value and register it in the Meta webhook config) | Per-tenant, via `WhatsAppAccount` (app UI); `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_TOKEN_ENCRYPTION_KEY` in `backend/.env` |
| **Stripe** | Subscription billing, checkout, customer portal | dashboard.stripe.com | `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live endpoint's signing secret) — **also create real Products/Prices and update `Plan.stripePriceId`** (currently `price_placeholder_*`, see §8) | `backend/.env`; Plan rows via `prisma/seed.ts` or `PATCH /admin/plans/:id` |
| **Hetzner (or equivalent VPS/cloud)** | Hosts the production server(s) | hetzner.com | SSH key, server IP | Referenced throughout `docs/PRODUCTION_DEPLOYMENT.md` |
| **Cloudflare (or equivalent DNS/CDN)** | DNS, optional CDN/WAF/DDoS mitigation in front of the app | cloudflare.com | DNS records pointed at the server; if used as a proxy, note it changes the client IP header the app sees (`CF-Connecting-IP`) — audit whether `RedisService`/rate limiting/`ipAddress` audit fields need updating to read it | DNS panel; app-level `X-Forwarded-For`/trust-proxy config if proxied |
| **SMTP provider** (e.g. Postmark, SES, SendGrid, Mailgun) | Transactional email — verification, password reset, notifications | Provider's own signup | `SMTP_HOST/PORT/USER/PASS`, and set `MAIL_FROM` to a domain-verified sender | `backend/.env` |
| **Domain registrar** | The production domain | Any registrar | DNS delegation to Cloudflare/host | N/A |
| **Google OAuth** | ⚠ Referenced in the schema (`User.googleId`) but the login flow is **not implemented** — do not list as a launch blocker unless product wants this feature | console.cloud.google.com, if built | Client ID/Secret | Not yet wired to any config key |
| **S3-compatible object storage** (AWS S3, Hetzner Object Storage, Cloudflare R2, etc.) | ❌ **No file/logo/media upload module exists at all** — `SalonProfile.logoUrl` and `Invoice.invoicePdfUrl` are bare URL strings with no upload path, and WhatsApp media messages store metadata only, no binary. Needed before logo upload or WhatsApp media download/storage can ship. | Provider signup | Access key/secret, bucket name | Not yet wired — no config keys exist |
| **Error tracking** (Sentry or equivalent) | ❌ Not integrated — no APM/error-tracking package in `package.json`, no DSN config anywhere | sentry.io or equivalent | DSN | Not yet wired |
| **Uptime/infra monitoring** (e.g. UptimeRobot, Better Stack, Grafana Cloud) | ❌ Not integrated. `GET /health` and `GET /health/ready` exist and are usable as monitoring targets today, but nothing polls them yet | Provider signup | — | Point an external check at `https://<domain>/health/ready` |
| **Product analytics** (e.g. PostHog, Mixpanel) | ⚠ Not integrated — not requested by requirements, listed here only because the original ask named it as a category | Provider signup | — | N/A unless scoped in |

---

## 3. Secrets Inventory

Every secret below must be **freshly generated for production** — never reuse the values from `backend/.env.example`, local dev, or CI's throwaway test values.

| Secret | Required length / format | Generation | Storage | Rotation |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | ≥32 chars (enforced) | `openssl rand -base64 48` | Server-side env only (never in git, never in frontend bundle) | Rotating invalidates **all** existing access tokens instantly (they fail signature verification) — acceptable since access tokens are short-lived (15 min); safe to rotate anytime, users just get a silent refresh |
| `JWT_REFRESH_SECRET` | ≥32 chars (enforced) | `openssl rand -base64 48`, **independently** from `JWT_ACCESS_SECRET` | Server-side env only | Rotating invalidates all refresh-token hashes — every logged-in user is force-logged-out. Plan a maintenance-window rotation, or add dual-secret verification support before rotating live |
| `WHATSAPP_APP_SECRET` | ≥32 chars (enforced) | Provided by Meta (App Dashboard → Settings → Basic) | Server-side env only | Rotate via Meta dashboard if compromised; update env and redeploy — inbound webhook signature checks will reject old-signed requests during the cutover window, so coordinate with Meta's own key rotation, not independently |
| `WHATSAPP_VERIFY_TOKEN` | ≥8 chars (enforced) | Any random string you choose | Server-side env + re-registered in Meta's webhook config on change | Low-sensitivity (only used once, at webhook subscription time) — rotate opportunistically |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Must base64-decode to exactly 32 bytes | `openssl rand -base64 32` | Server-side env only — **this is the only decryptable secret in the system** (AES-256-GCM key for `WhatsAppAccount.accessTokenEncrypted`) | **Rotating this key without a migration breaks decryption of every already-stored WhatsApp access token** — requires a re-encrypt migration (decrypt with old key, re-encrypt with new) before cutover, not a plain env swap |
| `OPENAI_API_KEY` | Provider-issued | platform.openai.com dashboard | Server-side env only | Rotate via OpenAI dashboard; no app-side migration needed, just redeploy with the new key |
| `AI_INTERNAL_API_KEY` | ≥32 chars (enforced) | `openssl rand -base64 32` | Server-side env only (never exposed to frontend) | Rotate anytime; only internal service-to-service calls use it |
| `STRIPE_SECRET_KEY` | Provider-issued (live key) | Stripe Dashboard → Developers → API keys | Server-side env only | Rotate via Stripe dashboard; old key remains valid until explicitly revoked, so no downtime rotation |
| `STRIPE_WEBHOOK_SECRET` | Provider-issued | Stripe Dashboard → Webhooks → your live endpoint | Server-side env only | Regenerating requires updating the env immediately — old signing secret stops verifying, so do this with a deploy ready to go, not casually |
| `SMTP_PASS` | Provider-issued | SMTP provider dashboard/API key | Server-side env only | Rotate per provider's own policy/on suspected compromise |
| `DATABASE_URL` (password component) | Strong random password | Set at Postgres user creation (`openssl rand -base64 24`, no shell-special chars) | Server-side env only | Rotate via `ALTER USER ... PASSWORD`, then update env + redeploy in the same maintenance window (no dual-credential support exists) |
| `REDIS_URL` (password component, if `requirepass` enabled) | Strong random password | `openssl rand -base64 24` | Server-side env only | Same as above — coordinate rotation with a redeploy |
| Cookie signing | N/A — no separate `COOKIE_SECRET` exists in this codebase; the refresh-token cookie carries only an opaque, server-hashed token, not a signed cookie payload | — | — | — |

**Note on secrets not present but named in the original ask:** `REFRESH_TOKEN_PEPPER` and `COOKIE_SECRET` don't exist as distinct variables in this codebase — `JWT_REFRESH_SECRET` already serves the pepper role for refresh-token hashing, and cookies aren't signed (they carry an opaque token, not readable/tamperable client data), so a separate cookie secret isn't architecturally needed here. `WEBHOOK_SECRET` similarly doesn't exist as one variable — it's split correctly per-provider into `WHATSAPP_APP_SECRET` and `STRIPE_WEBHOOK_SECRET`, which is the right design (a single shared "webhook secret" across two unrelated providers would be worse).

---

## 4. Production Infrastructure Review

| Area | Status | Detail |
|---|---|---|
| Docker images | ✔ Complete | `backend/Dockerfile` is a proper multi-stage build (`base` → `development` / `build` → `production`), production stage uses slim `node:20-alpine`, `npm ci --omit=dev`, runs `node dist/main.js`. |
| Docker image — non-root user | ⚠ Missing | No `USER` directive in `backend/Dockerfile`'s production stage — container runs as root. Add a non-root user before production use. |
| docker-compose (dev) | ✔ Complete | `infrastructure/docker-compose.yml` — postgres, redis, backend, frontend, nginx, all healthchecked. Explicitly labeled dev-only in its own header comment. |
| docker-compose (production) | ❌ **Required before production** | **No `docker-compose.prod.yml` exists.** The dev compose file runs the Angular **dev server**, not a static production build, and bind-mounts source — unsuitable for production as-is. |
| Nginx reverse proxy | ⚠ Partial | `infrastructure/docker/nginx/` config exists and sets some security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) but is explicitly dev-only (proxies to the Angular dev server, not a static build) and has **no CSP** (comment notes this is deferred). |
| SSL/TLS termination | ❌ **Required before production** | **Nothing exists** — no certbot/Let's Encrypt config, no cert volume, no 443 listener anywhere in `infrastructure/`. HTTP-only currently. |
| HTTPS enforcement / HSTS | ❌ **Required before production** | No `Strict-Transport-Security` header anywhere; depends on TLS termination existing first. |
| Database backups | ❌ **Required before production** | No backup automation found (`scripts/db/` exists but is empty). Needs a scheduled `pg_dump`/WAL-archiving strategy plus off-host storage (see §2's S3-compatible storage account). |
| Database migrations in deploy | ⚠ Partial | `prisma migrate deploy` is correctly used in CI (against an ephemeral test DB) and in the local bootstrap script — but **no CI/CD step runs it against a real staging/production database as part of a release**. See `docs/PRODUCTION_DEPLOYMENT.md` §"Migrations" for the manual procedure until this is automated. |
| CI | ✔ Complete (as a test gate) | `.github/workflows/ci.yml` — lint, unit tests, integration tests, build, for both backend and frontend, on every PR and push to `main`. |
| CD / deploy automation | ❌ **Required before production** (or accept fully manual deploys) | No Docker image build/push step, no deploy job, no `scripts/deploy/` contents (directory is empty). Deployment is 100% manual today — see `docs/PRODUCTION_DEPLOYMENT.md`. |
| Dependency/secret scanning | ⚠ Missing | No `npm audit` step, no Dependabot config, no SAST/secret-scanning step in CI. |
| Logging | ✔ Complete | Pino via `nestjs-pino`, structured JSON in non-dev, request-ID tagging, **redacts `authorization` and `cookie` headers** — good baseline hygiene. |
| Centralized log aggregation | ⚠ Missing | Logs go to stdout only; no shipping to a log aggregator (CloudWatch, Loki, Datadog, etc.) configured. Fine for `docker logs` on a single-VPS deploy, insufficient once you scale past one host. |
| Error tracking / APM | ❌ **Required before production** (strongly recommended) | Not integrated at all — see §2. Without it, production errors are only visible via raw logs. |
| Health checks | ✔ Complete | `GET /health` (liveness) and `GET /health/ready` (readiness — checks Postgres via `SELECT 1` and Redis via `PING`, both excluded from the API prefix/Swagger). Good foundation for both container healthchecks and external uptime monitoring. |
| Security headers (Helmet) | ❌ **Required before production** | **No `helmet` package, no import anywhere in `src/`.** Only the dev nginx layer sets a partial header set — bypassed entirely if Nginx isn't the real production entry point, or if it's swapped for a different reverse proxy/CDN. |
| Rate limiting (global) | ⚠ Partial → ❌ for non-auth routes | `@nestjs/throttler` is wired, but **scoped only to `AuthModule`** (login/register/password endpoints at 10/min, authenticated auth endpoints at 120/min) plus a bespoke AI chat guard. **Every other module — billing, salon, employees, services, customers, appointments — has zero rate limiting.** Webhook endpoints are intentionally unthrottled (rely on signature verification instead), which is fine. |
| Scaling / horizontal scale readiness | ⚠ Partial | The app itself is stateless (JWT + Redis-backed sessions/locks), so horizontal scaling of the `backend` container is plausible — but BullMQ queue processing runs **in-process** with the API server (no separate worker container), so scaling API replicas also scales/duplicates queue consumers, which needs verifying against BullMQ's concurrency model before doing it blindly. |
| Caching | ✔ Partial | Redis-backed caching exists for specific concerns (RBAC permission cache, availability locks, WhatsApp/Stripe webhook idempotency dedup) — no general HTTP response caching layer, which is appropriate for this kind of app. |
| Queue workers | ⚠ Missing (as a separate deployable) | BullMQ queues (`whatsapp-inbound`, `whatsapp-outbound`, `stripe-webhook`) exist and work, but only as in-process processors within the API server — no dedicated worker process/container, no independent scaling or crash-isolation from the API. |
| Cron jobs | ⚠ Missing | No scheduled-job runner (e.g. `@nestjs/schedule`) found for things like expired-token cleanup (`RefreshToken`/`PasswordReset`/`EmailVerification` rows), stale webhook-event pruning, or subscription-period housekeeping beyond what Stripe webhooks already drive. Verify what, if anything, currently prunes expired auth tokens — if nothing does, those tables grow unbounded. |
| Disaster recovery | ❌ **Required before production** | No documented DR plan, no tested restore procedure. Depends on backups existing first (see above). |

---

## 5. Security Review

### 5.1 Authentication — ✔ Solid foundation
Argon2id password hashing at strong parameters (64MiB/t=3/p=4 — above OWASP's minimum). Access tokens are short-lived JWTs (HS256, 15 min); refresh tokens are opaque, server-hashed, rotated on every use, with reuse-detection triggering all-device revocation. Login lockout after repeated failures. Email verification and password-reset flows exist with token expiry.

### 5.2 Authorization / RBAC — ✔ Solid, ⚠ one gap
Role-based (`SUPER_ADMIN`/`OWNER`/`MANAGER`/`STAFF`) with a documented, logged `SUPER_ADMIN` bypass (`SecurityEventService.record('SUPER_ADMIN_BYPASS', ...)` on every use — good audit practice for a necessarily-privileged path). ⚠ **Gap, per `docs/SECURITY.md`'s own "Known Gaps" section**: changing a user's role does not invalidate their already-issued access token — the stale `roles` claim persists until natural 15-minute expiry. Low severity given the short expiry, but worth fixing (`SessionService.revokeAllForUser()`) before a staff-role-management UI ships.

### 5.3 Tenant Isolation — ✔ Strong, by construction
The composite-FK cross-tenant pattern (`(tenantId, id)` compound uniques + compound FKs on Employee/Service/Customer/Appointment/Conversation/WhatsAppAccount) makes it a **database-level constraint violation**, not just an application bug, to link records across tenants — this is a materially stronger guarantee than most multi-tenant apps have and is worth calling out as a strength.

### 5.4 CSRF — ❌ **Required before production**
Refresh token is delivered via an `httpOnly`, `SameSite=Strict` cookie. `docs/SECURITY.md` explicitly documents this as a known, accepted gap today: no CSRF double-submit token on `/auth/refresh`/`/auth/logout`, relying on `SameSite=Strict` as the sole mitigation. `SameSite=Strict` is a reasonably strong control in modern browsers, but is not a substitute for defense-in-depth against a real CSRF token, especially given the cookie's scope covers state-changing auth operations. Add the double-submit token before launch, or explicitly accept the documented residual risk in writing.

### 5.5 XSS — ⚠ Framework-level protection only, not independently verified
Angular's default output-encoding provides baseline XSS protection on the frontend; no explicit audit was done here of every `[innerHTML]`/`bypassSecurityTrust*` usage — **action item**: grep the frontend for those specifically before launch, since any usage bypasses Angular's automatic sanitization. No CSP is configured anywhere (see §4), which would otherwise provide defense-in-depth against exactly this class of bug.

### 5.6 SQL Injection — ✔ Very low risk
Only one raw SQL query exists in the entire backend (`health.controller.ts`'s static `SELECT 1` for the readiness check, no interpolation). Everything else goes through Prisma's parameterized query builder. This is about as good as it gets without a full manual audit of every query — spot-checked, not exhaustively verified.

### 5.7 Rate Limiting — ❌ **Required before production**
See §4 — only auth endpoints and AI chat are rate-limited. Every other authenticated CRUD endpoint (appointments, customers, employees, services, billing) has no throttling, meaning a compromised or careless API token/session could hammer the backend or run up OpenAI/Stripe API costs (AI chat is covered, but e.g. bulk appointment creation isn't) without any built-in ceiling. Add a global `ThrottlerGuard` (`APP_GUARD` provider) with a sane default tier before launch, layering the existing tighter auth-specific tiers on top.

### 5.8 Secrets Management — ⚠ Partial
Fail-fast env validation is good practice. No secrets manager (Vault, AWS Secrets Manager, etc.) integration — secrets live in a `.env` file on the host. Acceptable for a single-VPS launch if file permissions are locked down (`chmod 600`, non-root-readable-only) and the file is never in version control (confirmed already gitignored) — revisit if/when the deployment moves to a multi-host or managed-container platform.

### 5.9 Encryption — ✔ Correct where it matters
AES-256-GCM for the one genuinely decryptable secret (`WhatsAppAccount.accessTokenEncrypted`), with authenticated encryption (auth tag) and a fail-fast key-length check at boot. Everything else sensitive (passwords, refresh tokens, invitation/verification tokens) is correctly one-way hashed rather than encrypted, which is the right choice for those.

### 5.10 Cookie Settings — ✔ Correct, one env-dependent caveat
`httpOnly: true`, `sameSite: 'strict'`, scoped `path`, and `secure` computed from `NODE_ENV==='production'`. **Operationally critical**: if `NODE_ENV` is ever misconfigured in the production environment (e.g., left at the default `development`), the refresh cookie silently loses its `Secure` flag and would be sent over plain HTTP if TLS termination weren't otherwise enforced. Verify `NODE_ENV=production` is set explicitly in the production env, don't rely on the default.

### 5.11 Webhook Verification — ✔ Complete
WhatsApp: HMAC-SHA256 over the raw request body via `WHATSAPP_APP_SECRET`, constant-time comparison (`timingSafeEqual`), rejects missing/malformed signatures. Stripe: verified via Stripe SDK's own `constructEvent` against the raw body and `Stripe-Signature` header. Both correctly read the **raw** body (not JSON-reparsed) — a common webhook-verification bug this codebase avoids.

### 5.12 JWT — ✔ Reasonable, standard config
HS256, no `alg: none` risk (algorithm isn't attacker-controlled since it's not read from the token), 15-minute access token expiry limits the blast radius of a leaked token.

### 5.13 Refresh Tokens — ✔ Strong design
Opaque (not a JWT — nothing to decode/tamper with client-side), rotated on every use, reuse-detected (a replayed old refresh token revokes the entire session family) — this is the correct, more secure pattern versus a long-lived static refresh JWT.

### 5.14 Audit Logs — ⚠ Partial
`AuditLog` table exists and is populated for tenant lifecycle, settings changes, invitations, and Super Admin tenant-switch events. Per `docs/SECURITY.md`'s own gap list: `SecurityEventService`'s auth/RBAC event log lines (register, login, `SUPER_ADMIN_BYPASS`, lockouts, etc.) are **not yet** persisted into the same `AuditLog` table — they're logged via the structured logger only, not queryable as durable audit records. Low urgency (they are captured somewhere, just not in the queryable audit trail) but worth closing before a compliance-sensitive customer asks for an audit export.

### 5.15 OWASP Top 10 (2021) — summary pass

| # | Category | Status |
|---|---|---|
| A01 | Broken Access Control | ✔ Strong (RBAC + DB-level tenant isolation) |
| A02 | Cryptographic Failures | ✔ Strong (Argon2id, AES-256-GCM, correct one-way hashing elsewhere) |
| A03 | Injection | ✔ Very low risk (Prisma parameterized queries, one static raw query) |
| A04 | Insecure Design | ⚠ Mostly strong; CSRF gap and unscoped rate limiting are the notable design gaps |
| A05 | Security Misconfiguration | ❌ No Helmet, no CSP, no HSTS, no prod TLS — the biggest concentration of gaps |
| A06 | Vulnerable and Outdated Components | ⚠ Unverified — no `npm audit`/Dependabot in CI; run one before launch and periodically after |
| A07 | Identification and Authentication Failures | ✔ Strong (lockout, Argon2id, rotated refresh tokens, reuse detection) |
| A08 | Software and Data Integrity Failures | ✔ Webhook signatures verified correctly for both providers |
| A09 | Security Logging and Monitoring Failures | ⚠ Logging is good; monitoring/alerting/error-tracking is not integrated (§4) |
| A10 | Server-Side Request Forgery | ✔ No user-controlled outbound URL fetching identified in this audit |

---

## 6. Acceptance Criteria vs. Architecture Documents

Comparing the as-built system against `docs/SYSTEM_ARCHITECTURE.md` (Draft) and `docs/SECURITY.md` (As-Built, authoritative where the two conflict).

| Item | Status |
|---|---|
| Core product features (M1–M9: auth, multi-tenancy, salon, workforce, services, customers, scheduling, WhatsApp, AI, billing) | ✔ Complete |
| Database-level tenant isolation (composite FKs) | ✔ Complete |
| Password hashing, JWT/refresh rotation, lockout | ✔ Complete |
| Webhook signature verification (WhatsApp + Stripe) | ✔ Complete |
| Encryption at rest for WhatsApp access tokens | ✔ Complete |
| Health check endpoints | ✔ Complete |
| Structured logging with sensitive-header redaction | ✔ Complete |
| CI test/lint/build gate | ✔ Complete |
| CSRF protection on refresh/logout | ❌ Required before production |
| Global API rate limiting | ❌ Required before production |
| Security headers (Helmet, CSP, HSTS) | ❌ Required before production |
| TLS/SSL termination | ❌ Required before production |
| Production docker-compose topology | ❌ Required before production |
| Database backup automation | ❌ Required before production |
| Disaster recovery plan + tested restore | ❌ Required before production |
| Deployment automation (CD) | ❌ Required before production (or explicitly accept manual deploys) |
| Error tracking / APM | ❌ Required before production (strongly recommended) |
| Real Stripe Products/Prices (currently placeholder IDs) | ❌ Required before production |
| Dependency vulnerability scanning in CI | ⚠ Missing, recommended |
| Role-change session invalidation | ⚠ Missing, low severity |
| Full `SecurityEventService` → `AuditLog` persistence | ⚠ Missing, low urgency |
| Non-root Docker user | ⚠ Missing |
| Expired-token cleanup cron | ⚠ Missing — verify, may cause unbounded table growth |
| Dedicated queue worker process | ⚠ Missing — architectural nice-to-have, not a launch blocker at current scale |
| Google OAuth login | ⚠ Not implemented (only relevant if product wants this) |
| File/object storage (logo upload, WhatsApp media, invoice PDFs) | ⚠ Not implemented — no S3 module exists |

---

## 7. Prioritized Punch List Before Launching to Real Customers

**P0 — Blocking, do not launch without these:**
1. Provision TLS (Let's Encrypt/Certbot or a Cloudflare-proxied cert) and enforce HTTPS + HSTS.
2. Build `docker-compose.prod.yml` (or equivalent) — static Angular build served by Nginx, hardened images, no source bind-mounts, no dev servers.
3. Add Helmet (or equivalent header middleware) with a real CSP.
4. Add a global rate-limit guard (`APP_GUARD` + `ThrottlerGuard`) covering every route, not just auth.
5. Set up automated Postgres backups (scheduled dump + off-host storage) and **test a real restore**, not just confirm the backup job runs.
6. Replace placeholder Stripe Price IDs (`price_placeholder_*`) with real live-mode Products/Prices.
7. Set every secret in §3 to a freshly generated production value — confirm none of the `.env.example`/dev values leaked into production config.
8. Confirm `NODE_ENV=production` is actually set in the production environment (cookie `Secure` flag depends on it).
9. Integrate error tracking (Sentry or equivalent) — flying blind on production errors otherwise.

**P1 — Should fix before or very shortly after launch:**
10. Add the CSRF double-submit token on `/auth/refresh`/`/auth/logout`, or formally document/accept the `SameSite=Strict`-only mitigation as a conscious risk decision.
11. Add `npm audit`/Dependabot to CI.
12. Add a non-root `USER` to the production Docker image.
13. Verify (or build) a cron/scheduled job to prune expired `RefreshToken`/`PasswordReset`/`EmailVerification` rows.
14. Confirm the production Angular build's API base URL and `CORS_ORIGIN` both point at the real domains, not localhost.
15. Set up uptime monitoring against `/health/ready`.
16. Write and rehearse the deployment/rollback procedure at least once against a staging environment (see `docs/PRODUCTION_DEPLOYMENT.md`).

**P2 — Track, not blocking:**
17. Persist `SecurityEventService` auth/RBAC events into the durable `AuditLog` table.
18. Add role-change → session invalidation (`SessionService.revokeAllForUser()`).
19. Consider splitting BullMQ queue processing into a dedicated worker process once traffic justifies independent scaling.
20. Build an S3-compatible storage module if/when logo upload, WhatsApp media persistence, or hosted invoice PDFs become required.
21. Set up log aggregation once running on more than one host.
22. Google OAuth — only if product decides to support it.

See `docs/PRODUCTION_DEPLOYMENT.md` for the step-by-step server setup that operationalizes the P0/P1 items above.
