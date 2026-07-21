# Architecture Review — Milestone 1 (Project Foundation)

**Date:** 2026-07-21
**Scope:** Entire repository as it stands after Milestone 1, reviewed against PROJECT_REQUIREMENTS.md, SYSTEM_ARCHITECTURE.md, DATABASE_DESIGN.md, PRISMA_SCHEMA.md, API_SPECIFICATION.md, FRONTEND_ARCHITECTURE.md, and IMPLEMENTATION_ROADMAP.md.
**Type:** Read-only audit. No code was modified to produce this document.

---

## ✓ Strengths

1. **Every documented deviation is logged, not silent.** docs/DECISIONS.md (ADR-001) records six implementation-time decisions (folder rename, Prisma version pin, Tailwind version pin, incremental schema scope, `angular-eslint` version pin, health-endpoint envelope exemption) with rationale. Cross-checking the repo against the seven planning documents found no *undocumented* drift — every place code and doc diverge, the doc trail already explains why.

2. **The response contract is enforced structurally, not by convention.** `ResponseTransformInterceptor`, `GlobalExceptionFilter`, and the `validationExceptionFactory` together mean no controller can accidentally return a shape other than API_SPECIFICATION.md §2.2/2.3's envelope — a future engineer writing a new controller gets the correct shape for free rather than having to remember to build it.

3. **Fail-fast configuration is real, not aspirational.** `env.validation.ts` uses `class-validator` with no optional fallback for `DATABASE_URL`/`REDIS_URL`; a misconfigured deployment won't start rather than failing confusingly on first request. This was verified live (Task 3 of the pre-commit review) by deleting `.env` and confirming the exact failure path.

4. **The pre-commit review caught a real, reproducible bug** (`angular-eslint` pinned to a version built for Angular 21, passing `npm install` but failing `npm ci`) by testing from an actual clean clone rather than trusting a working local `node_modules`. That discipline is itself evidence the foundation is more solid than "it works on my machine."

5. **Scope discipline held.** No business modules, no premature repository/base-class abstractions, no auth code exists yet — matching the explicit Milestone 1 instruction. `modules/`, `core/`, `queues/` are genuinely empty rather than pre-populated with speculative scaffolding.

6. **Naming and DI conventions are consistent** across both apps: kebab-case files, constructor-only injection (verified via grep — zero `@Inject()` property injection, zero `@Input()`/`@Output()` decorators), `OnPush` on every Angular component, standalone components exclusively. This matches IMPLEMENTATION_ROADMAP.md §12.2/12.4/12.10 exactly.

---

## ⚠ Risks

1. **No security headers at the NestJS layer.** `infrastructure/docker/nginx/nginx.conf` sets `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`, but the backend itself sets none. Port 3000 is published directly to the host in `docker-compose.yml` for local-dev convenience — in any topology where the backend is reachable without going through nginx (a misconfigured deploy, a debugging session against a shared environment), there is zero header hardening. SYSTEM_ARCHITECTURE.md §9.7 says headers are enforced "via Nginx **and/or** NestJS middleware (e.g., Helmet)" — currently only the "and" is missing; only nginx does it.

2. **No rate limiting anywhere yet.** SYSTEM_ARCHITECTURE.md §9.2 specifies per-IP/per-user limiting at the Nginx and/or NestJS-guard layer. Neither exists — no `limit_req` in nginx.conf, no `@nestjs/throttler` or equivalent in the backend. Low urgency today (the only public surface is `/health`, `/health/ready`, `/api/docs`), but this needs to land no later than the moment Milestone 2 opens `/auth/login` to the public internet, since IMPLEMENTATION_ROADMAP.md's own Sprint 2.1 assumes it's available ("rate limiting on the Public-Sensitive tier").

3. **Swagger is unconditionally enabled, including in a hypothetical production build.** `main.ts` calls `SwaggerModule.setup('api/docs', app, ...)` with no `NODE_ENV` gate. Not a documented requirement violation (no doc mandates gating it), but it's a standard hardening step and worth a deliberate decision — either gate it behind non-production, or behind auth, before Milestone 10.

4. **`docker-compose.yml` publishes Postgres (5432) and Redis (6379) directly to the host.** Correct and necessary for local dev; the file's own header comment already states this is the dev stack, not `docker-compose.prod.yml`. Flagged here only so it's an explicit, verified fact for whoever builds the production compose file in Milestone 10 — that file must not carry these port mappings over, per SYSTEM_ARCHITECTURE.md §10.2's "only Nginx exposed" requirement.

5. **No dependency-vulnerability scanning in CI.** SYSTEM_ARCHITECTURE.md §9.1 and §10.5 both name this explicitly ("Dependabot or equivalent" / "npm audit gate"). `.github/workflows/ci.yml` has no `npm audit` step, and there's no `.github/dependabot.yml`. This is a concrete, named requirement with nothing implementing it yet.

6. **No PR template.** IMPLEMENTATION_ROADMAP.md §2.5 specifies a mandatory five-point PR template (linked task, what/why, source-of-truth-doc-updated confirmation, testing evidence, screenshots for UI changes). No `.github/pull_request_template.md` exists, so nothing currently enforces this at the point a PR is opened — it depends entirely on the author remembering.

---

## Recommendations

1. **Add `helmet` to the NestJS bootstrap** (`app.use(helmet())` in `main.ts`) as defense-in-depth alongside the existing nginx headers — small change, closes Risk 1 entirely.
2. **Add `@nestjs/throttler`** as a global guard before Milestone 2's auth endpoints exist, so the "Public-Sensitive tier" rate limit Sprint 2.1 assumes doesn't have to be built and wired in the same PR as login/register.
3. **Decide and implement a Swagger production policy** (env-gated or auth-gated) — cheap now, easy to forget once there are 60+ documented endpoints and it feels riskier to change.
4. **Add `.github/dependabot.yml`** (weekly, npm ecosystem, both `backend/` and `frontend/` directories) and an `npm audit --audit-level=high` step in `ci.yml` — both are small, mechanical additions that directly close a named SYSTEM_ARCHITECTURE.md requirement.
5. **Add `.github/pull_request_template.md`** matching IMPLEMENTATION_ROADMAP.md §2.5's five points verbatim, so the checklist is presented automatically rather than relied on from memory.
6. **Replace the `request.path.startsWith('/health')` check** in `ResponseTransformInterceptor` with an exact match or a small `@SkipEnvelope()` decorator + `Reflector` check. `startsWith` will silently also un-wrap any future route that happens to start with `/health` (e.g. a hypothetical `/health-check-config` admin endpoint) — low probability, easy to make robust now while there's only one caller to update.
7. **Consider renaming `DatabaseModule`** (`src/database/`) or splitting it once Redis's role expands beyond "one more connection to establish." Bundling `PrismaService` and `RedisService` under one module was a deliberate, logged choice (ADR-001) to match a literally-requested folder name, but "database" undersells what's really a general persistence/connections module — worth revisiting once distributed locks (booking-conflict prevention, Milestone 5) and queue backing (BullMQ, Milestone 5+) make Redis's responsibilities clearly distinct from Prisma's.

---

## Technical Debt

*(Named here because it's already flagged as intentional and expected, per IMPLEMENTATION_ROADMAP.md's own incremental-delivery model — listed for visibility, not as new findings.)*

1. **Zero automated tests.** `backend/test/{unit,integration,e2e}` and the frontend's Karma setup are wired and working, but contain no real test beyond the scaffolded default. This is correct for Milestone 1 (no business logic exists to test) but is the single largest debt item the moment Milestone 2 starts — IMPLEMENTATION_ROADMAP.md §9's Definition of Done requires unit + integration tests (including a failure-path case) on every PR from here on.
2. **Prisma schema is 4 of ~55 documented models.** Expected and by design (PRISMA_SCHEMA.md §14.2's migration order), but means every future milestone carries schema-growth work that hasn't happened yet — not a defect, just unrealized scope.
3. **Prisma pinned to 6.19.3 while 7.x exists.** A deliberate, logged choice (ADR-001) to match PRISMA_SCHEMA.md's documented schema syntax. Will eventually require a real migration effort (new generator config, `prisma.config.ts`, client `output` path) — worth budgeting a dedicated task for later rather than doing it incidentally inside an unrelated feature PR.
4. **Frontend/backend DTO sync is manual.** FRONTEND_ARCHITECTURE.md §2.2 already flags this as a known, accepted MVP-scope limitation ("codegen as a future improvement, not adopted at MVP scope") — restated here because the error-code catalog is a specific instance of it: `backend/src/common/constants/error-codes.constant.ts` is a typed enum-like const; the frontend's `ApiError.code` is a bare `string`. No compile-time guarantee the two ever agree.
5. **CI runs lint → migrate → test → build for the backend, without a standalone typecheck step.** SYSTEM_ARCHITECTURE.md §10.5 lists "install → lint → type-check → unit tests → build" as five distinct stages; `nest build` does perform full type-checking as part of compilation, so nothing is actually unchecked, but a failing type error currently only surfaces at the build step rather than failing fast immediately after lint. Minor; worth a dedicated `tsc --noEmit` step if CI runtime ever becomes a concern worth optimizing for fail-fast ordering.

---

## Future Improvements

1. **Non-root Docker users.** Both `Dockerfile`s run as the image default (root) in every stage. Not a documented requirement, but standard container-hardening practice worth adding to the production stages before Milestone 10.
2. **Structured request/response schema codegen** (OpenAPI → TypeScript types) to close the manual-DTO-sync gap noted above — FRONTEND_ARCHITECTURE.md already names this as a future improvement, not new to this review.
3. **Split `schema.prisma` into multiple files** once it grows large enough to be unwieldy as one file — Prisma supports this as a preview feature; not needed at 4 models, worth revisiting around the Milestone 5–6 mark when the model count climbs past 25–30.
4. **A `CONTRIBUTING.md`** consolidating IMPLEMENTATION_ROADMAP.md §2 (git workflow, commit conventions, PR process) into a single onboarding-friendly document, once/if a second contributor joins (§2.6 already anticipates this transition explicitly).
5. **Formalize the CSP header** once the frontend's actual script/style/connect-source inventory is known (deferred deliberately — nginx.conf's own comment already flags this as blocked on the pending Design System document, not forgotten).

---

## Summary

No architecture drift was found that isn't already logged in docs/DECISIONS.md. The codebase is smaller in scope than the seven planning documents describe (correctly — most of those documents describe Milestones 2–10, not yet built), and within that smaller scope it follows the documented conventions consistently. The findings above are either (a) named requirements from SYSTEM_ARCHITECTURE.md/IMPLEMENTATION_ROADMAP.md that don't yet have corresponding code — real gaps, cheap to close, all low-urgency at Milestone 1's current attack surface — or (b) forward-looking judgment calls with no wrong answer yet, flagged so they're decided deliberately rather than by default. Nothing found rises to "block Milestone 2."
