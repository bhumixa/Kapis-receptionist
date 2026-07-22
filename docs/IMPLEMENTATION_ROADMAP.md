# IMPLEMENTATION_ROADMAP.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### Master Development Guide

**Document Status:** Draft for Approval
**Version:** 1.0
**Depends on:** PROJECT_REQUIREMENTS.md, SYSTEM_ARCHITECTURE.md, DATABASE_DESIGN.md, PRISMA_SCHEMA.md, API_SPECIFICATION.md, FRONTEND_ARCHITECTURE.md (v1.0 each)
**Scope:** Implementation roadmap and process only. No application code. This is the master plan development sessions (human or AI-assisted) execute against — every subsequent coding session should orient itself against this document's current milestone/sprint before writing anything.

---

## 1. Development Strategy

### 1.1 Why This Implementation Order Was Chosen

The ten milestones (Section 3) follow the **dependency graph the prior six documents already established**, not an arbitrary feature-priority ordering:

1. **Foundation before anything** — Docker Compose, CI/CD, and the base NestJS/Angular skeletons (PRISMA_SCHEMA.md Section 14.2's own migration-order logic starts the same way, with global reference tables before anything tenant-owned) must exist before a single feature can be built, tested, or deployed.
2. **Auth and Multi-Tenancy before every domain feature** — SYSTEM_ARCHITECTURE.md Section 8 and DATABASE_DESIGN.md Section 5 both treat tenant isolation as the platform's foundational correctness property, not a feature among features. Every module built afterward (Employees, Services, Appointments, Conversations, Billing) assumes a working tenant-context/RBAC layer already exists — building it last, or retrofitting it, would mean re-touching every module a second time, exactly the kind of avoidable technical debt this roadmap is designed to prevent.
3. **Salon Management (catalog data) before Scheduling** — the `Availability` engine and `Appointments` module (DATABASE_DESIGN.md Section 3.5) have a hard data dependency on `Employee`, `Service`, and `EmployeeService` already existing; there is no version of the booking engine that can be meaningfully built or tested against an empty catalog.
4. **Scheduling before WhatsApp, WhatsApp before AI** — the AI's entire value proposition (PROJECT_REQUIREMENTS.md Section 4) is executing real bookings through a real messaging channel. SYSTEM_ARCHITECTURE.md Section 5.3 is explicit that the AI *decides*, the backend *executes* — meaning the booking engine and the WhatsApp transport layer must both already work, independently and provably, before AI orchestration is layered on top. Building AI first against a stubbed booking engine would produce a demo that lies about what's actually production-ready.
5. **Billing after the product has something worth paying for** — Stripe integration is deliberately sequenced after the core product loop (book/reschedule/cancel via AI over WhatsApp) is functional, not before, so billing enforcement (`TenantActiveGuard`, plan limits) is tested against a real, working product rather than an empty shell.
6. **Analytics, Notifications, and Admin after there is data to show** — these are inherently derivative/aggregate features (SYSTEM_ARCHITECTURE.md Section 3.2's `Dashboard`/`Admin` modules compose from other modules' data); building them earlier would mean building against fixtures instead of real system behavior.
7. **Production Deployment last, and deliberately feature-frozen** — Milestone 10 adds no new product features; it exists solely to harden, test, and safely launch what M1–M9 built, preventing the common failure mode where "one more feature" keeps delaying a properly-hardened launch.

### 1.2 Dependencies Between Modules

Backend module dependencies mirror SYSTEM_ARCHITECTURE.md Section 3.3's dependency graph exactly; frontend feature dependencies mirror FRONTEND_ARCHITECTURE.md Section 1.5's feature-first boundaries mapped onto the same backend domains. Section 5 and Section 6 of this document restate both graphs specifically as **build-order** lists (not just architectural dependency lists), since "what depends on what" and "what should be built before what" are related but not identical questions — a module can be architecturally depended-upon without needing to be *fully* built before its dependents' *first* working version exists (Section 1.4's walking-skeleton approach exploits this distinction deliberately).

### 1.3 Risk Management Strategy

Two risk categories are managed with different strategies, not one blanket approach:

- **Correctness/foundational risks** (tenant data isolation, booking-conflict prevention, auth security) are addressed **in dependency order**, early, and are never deferred — DATABASE_DESIGN.md's Risk DB-R1 (cross-tenant FK integrity) and DB-R3 (booking race conditions) are explicitly called out as Sprint 3.1 and Sprint 5.1 deliverables respectively (Section 4), not left as "harden later" items, because retrofitting correctness into a system already full of features is far more expensive and error-prone than building it in from the start.
- **External-dependency/integration risks** (WhatsApp Business Account verification lead time, OpenAI API behavior under real conversational load, Stripe webhook edge cases) are addressed via **early spikes that run in parallel with, not blocking, the dependency-ordered critical path** — Sprint 1.1 explicitly includes a time-boxed WhatsApp Business verification kickoff (Section 4) specifically *because* Meta's app-review process can take days to weeks and is entirely outside developer control (Section 10's top delivery risk), even though the WhatsApp integration itself isn't built until Milestone 6. Starting the clock on external, non-technical lead times as early as possible is a deliberate schedule-risk mitigation, independent of the technical build order.

### 1.4 Incremental Delivery Approach

- **Walking skeleton first, breadth before depth within each milestone.** Each milestone's first sprint aims for a thin, real, end-to-end slice (e.g., Milestone 6's first sprint gets a real WhatsApp message from a real number into a real database row and back out again, before template messages, media handling, or polish are added) rather than building one module to 100% completeness before starting the next — this surfaces integration problems (the riskiest kind) as early as possible within each milestone, not at the end.
- **Every milestone ends in a deployed, demoable increment on staging** (SYSTEM_ARCHITECTURE.md Section 10.11's rolling-deploy strategy applies from Milestone 1 onward, not bolted on at the end) — "done" for a milestone means a stakeholder can click through the real staging environment and see the milestone's stated capability working, not just "the code is merged."
- **Feature flags, not long-lived branches, isolate incomplete cross-milestone work** (Section 2.2) — e.g., the AI module's tool-calling endpoints (Milestone 7) can exist and be merged to `main` disabled-by-default while Milestone 6 is still being finished, avoiding the integration-debt buildup of a long-running feature branch.

### 1.5 MVP vs. Production Features

This roadmap targets **exactly** PROJECT_REQUIREMENTS.md Section 12's MVP Scope, delivered incrementally across Milestones 1–9, with Milestone 10 dedicated purely to production-readiness (security, performance, monitoring, deployment) rather than new functionality. PROJECT_REQUIREMENTS.md Section 11's Future Features (multi-location/room-based booking, voice channel, in-chat payments, white-labeling, etc.) are **explicitly out of scope for every milestone in this roadmap** — where PRISMA_SCHEMA.md already modeled a future-ready hook for one of these (`Branch`, `Room`, PRISMA_SCHEMA.md Section 5.1), this roadmap's sprints leave those tables present but unused/optional, never spend implementation effort activating them. This boundary is restated here because scope creep during implementation — "while I'm in the Appointments module, let me also wire up Room assignment" — is one of the most common sources of the technical debt and schedule risk this roadmap exists to prevent (Section 10).

---

## 2. Repository Strategy

### 2.1 Monorepo Structure

A **single monorepo**, not separate frontend/backend repositories — matching SYSTEM_ARCHITECTURE.md Section 14's recommended folder structure exactly:

```
kapis-receptionist/
├── backend/            # NestJS application (SYSTEM_ARCHITECTURE.md Section 14)
├── frontend/           # Angular application (SYSTEM_ARCHITECTURE.md Section 14)
├── infrastructure/     # Docker Compose, Nginx, env templates
├── .github/workflows/  # CI/CD pipelines
├── scripts/            # DB backup/restore, deploy, local bootstrap
└── docs/               # This document and its five predecessors, plus CHANGELOG.md and runbooks/
```

**Why monorepo over polyrepo:** the API contract (API_SPECIFICATION.md) is a single source of truth shared by both applications — a monorepo lets a single pull request change a backend DTO and its matching frontend model together, reviewed and merged atomically, rather than requiring two coordinated PRs across two repositories with a window of inconsistency between them. It also gives one CI pipeline, one issue tracker, and one place a new contributor (human or AI-assisted session) needs to look to understand the whole system — consistent with the modular-monolith philosophy SYSTEM_ARCHITECTURE.md Section 2.2 already applied to the backend's *code* structure, extended here to the *repository* structure for the same reasons (small team, low operational overhead, atomic cross-cutting changes).

### 2.2 Branch Strategy

**Trunk-based development with short-lived feature branches.** `main` is always deployable (CI-gated, Section 13) and is what auto-deploys to staging on every merge (SYSTEM_ARCHITECTURE.md Section 10.11). Every unit of work — one sprint task, one bug fix — gets its own branch (`feature/<milestone>.<sprint>-<short-description>`, `fix/<description>`, `chore/<description>`), opened against `main`, merged within days, never weeks. No long-lived `develop` branch, no GitFlow release branches — trunk-based is chosen specifically because it minimizes merge-conflict risk and keeps every increment small enough to review properly (Section 1.4's incremental-delivery philosophy applied to version control), which matters more for a solo-developer-plus-AI-assistance context (Section 11) than a heavyweight branching model designed for large, multi-team coordination this project doesn't have.

**Incomplete cross-milestone work** (Section 1.4) is merged to `main` behind a feature flag (a simple `SystemSetting`/environment-variable-driven toggle, PRISMA_SCHEMA.md Section 12) rather than kept on a long-lived branch — trunk-based development's core discipline.

### 2.3 Git Workflow

1. Branch off latest `main`.
2. Implement one sprint task (Section 4) — deliberately scoped small (Section 14's AI Collaboration Rules formalize this same discipline for AI-assisted sessions specifically).
3. Open a PR against `main` (Section 2.5's PR process, template-driven).
4. CI runs automatically (Section 13's Quality Gates).
5. Review (Section 2.6) → merge (squash merge, keeping `main`'s history one commit per logical change, not per work-in-progress commit).
6. Merge triggers automatic staging deploy (SYSTEM_ARCHITECTURE.md Section 10.5).
7. Production deploy is a **separate, deliberate, manually-triggered** promotion from a tagged staging-verified commit (Section 2.7) — never automatic, consistent with the "risky/hard-to-reverse actions require explicit confirmation" principle this entire project has been built under.

### 2.4 Commit Message Conventions

**Conventional Commits**, exactly: `<type>(<scope>): <description>`, where `type` is one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, and `scope` names the affected module (`feat(appointments): add conflict-prevention Redis lock`, `docs(api-spec): document invitation-acceptance endpoint`). This convention is chosen because it (a) makes `git log` itself a readable, filterable changelog — directly feeding Section 2.7's release notes generation — and (b) is unambiguous for an AI-assisted session to apply consistently, reducing a class of small, easily-automatable inconsistency that would otherwise need human cleanup.

### 2.5 Pull Request Process

Every PR uses a fixed template requiring: (1) a link to the sprint task it implements (Section 4); (2) a summary of *what* changed and *why* (not just *what*, per this project's general documentation philosophy of capturing rationale); (3) confirmation that the relevant source-of-truth document (PRISMA_SCHEMA.md, API_SPECIFICATION.md, FRONTEND_ARCHITECTURE.md) was updated in the same PR if the change touched schema, API contract, or frontend architecture (Section 8's living-document policy — enforced here at the PR-template level, not left as a separate, skippable step); (4) evidence of testing (which test types from Section 13 were run/added); (5) for UI changes, before/after screenshots. No PR is opened without at least one associated task from the current sprint's plan — ad hoc, untracked work is exactly the kind of scope-creep risk Section 1.5 and Section 10 flag.

### 2.6 Code Review Process

This project is scoped for **one experienced developer working with AI assistance** (Section 11) — the review process is adapted accordingly, not a fiction of a multi-person team that doesn't exist:

- **Every PR gets an independent AI review pass** (a separate reasoning pass — e.g., a fresh review-focused session with no memory of the implementation session's assumptions — reviewing against this project's own six prior documents plus Section 9's Definition of Done) **before** the developer's own final read-through, catching the class of error where an implementer is too close to their own code to see it (SYSTEM_ARCHITECTURE.md's own review-quality reasoning, applied to this project's own development process).
- **A human-authored self-review checklist** (derived directly from Section 9's Definition of Done and Section 13's Quality Gates) is completed by the developer before merge — a lightweight but mandatory substitute for a second human reviewer.
- **If/when a second human joins the project**, the process upgrades immediately to requiring one human approval in addition to the AI review pass — this document's process should be read as the floor for a solo context, not a permanent ceiling.

### 2.7 Release Strategy

- Releases are cut from `main` at **milestone boundaries** (Section 3) by default — a milestone's completion is also a release, keeping releases meaningful and demoable rather than arbitrary. An urgent production fix may also trigger an out-of-cycle patch release (Section 2.2's trunk-based model supports this cleanly — a fix branch off `main`, fast-tracked through the same PR/CI process, tagged immediately).
- Every release is **tagged** (`v<major>.<minor>.<patch>`, Section 2.8) and accompanied by a `CHANGELOG.md` entry generated substantially from the Conventional Commit history (Section 2.4) since the prior tag, hand-edited for clarity where needed.
- **Staging is always current** (every `main` merge deploys there automatically); **production deploys are promotions of a specific, already-staging-verified tag**, never a direct `main`-to-production path — giving a deliberate, auditable gap between "code merged" and "code live for real tenants," consistent with SYSTEM_ARCHITECTURE.md Section 10.11's deployment strategy.

### 2.8 Versioning

**Semantic Versioning (SemVer)** for the platform release as a whole (`MAJOR.MINOR.PATCH`) — `MAJOR` reserved for a breaking API change requiring a `/v2` bump (API_SPECIFICATION.md Section 2.1), `MINOR` for a milestone completion or any backward-compatible feature addition, `PATCH` for bug fixes and small corrections. This is **explicitly a distinct versioning concept from the API's own URI versioning** (`/api/v1`, API_SPECIFICATION.md Section 2.1) — the platform can ship many `MINOR`/`PATCH` releases while the API contract itself stays at `v1` throughout; conflating the two (assuming a `v2.0.0` platform release implies an `/api/v2` breaking API change) is a documented, deliberate non-relationship worth stating explicitly so it's never assumed otherwise.

---

## 3. Milestones

| # | Milestone | Goal | Sprints | Exit Criteria |
|---|---|---|---|---|
| 1 | **Project Foundation** | A running, deployable, empty skeleton | 1 | `docker compose up` runs the full stack locally; CI passes on a trivial PR; `/health` responds; first Prisma migration (global reference tables) applied cleanly. |
| 2 | **Authentication** | Full login/session lifecycle, both directions of the stack | 2 | A user can register, verify email, log in, refresh a session, reset a forgotten password, and log in via Google — end to end, staging-deployed. |
| 3 | **Multi-Tenancy** | Tenant isolation proven, not assumed | 1 | Registration provisions a full `Tenant` + `Owner` + `TenantSettings` + trial `Subscription` atomically; cross-tenant access attempts verifiably rejected in integration tests (DATABASE_DESIGN.md Risk DB-R1 closed). |
| 4 | **Salon Management** | The catalog data every later milestone depends on | 2 | Owner can fully configure Employees, Services, working hours, holidays, and Customers through the dashboard; `Files` upload gap (API_SPECIFICATION.md Section 18.2) closed. |
| 5 | **Scheduling Engine** | The core, highest-stakes product capability | 2 | Staff can book, reschedule, and cancel an appointment through the dashboard with real conflict prevention (DATABASE_DESIGN.md Risk DB-R3 closed) and reminders firing on schedule. |
| 6 | **WhatsApp Integration** | Real messages flowing in and out | 2 | A real WhatsApp number receives a real customer message, it's visible in the dashboard inbox, and staff can reply — no AI yet, pure transport + human handling. |
| 7 | **AI Assistant** | The product's core differentiator, live | 2 | A real WhatsApp customer can book, reschedule, or cancel an appointment through an AI conversation, with guardrails, confirmation, and human-escalation all functioning. |
| 8 | **Billing** | The business can collect money | 2 | A tenant can subscribe to a paid plan via Stripe Checkout, see invoices, get blocked appropriately on payment failure, and get unblocked on resolution. |
| 9 | **Analytics, Notifications & Admin** | Insight and oversight surfaces | 2 | Dashboard/Analytics/Reports render real data; email notifications fire for key events; the Super Admin console is functional and provably isolated from tenant-scoped data. |
| 10 | **Production Deployment** | Safe, monitored, real-world launch | 2 | Security review complete, load-tested, deployed on Hetzner behind TLS, monitoring/alerting live, backup/restore drilled, first real pilot tenant live. |

**Total: 18 sprints** (Section 4's detail, Section 11's timeline conversion).

---

## 4. Sprint Planning

Each sprint is scoped to roughly one working week for the solo-developer-plus-AI-assistance context (Section 11 converts this into calendar-time estimates with appropriate ranges — a "sprint" here is a planning unit, not a promise of exactly five calendar days).

### Milestone 1 — Project Foundation — ✅ Complete (2026-07-21)

#### Sprint 1.1 — Repository, Infrastructure & CI Skeleton — ✅ Complete
- **Objectives:** stand up the monorepo, local Docker stack, and CI pipeline; kick off the WhatsApp Business verification lead-time clock (Section 1.3).
- **Tasks:** initialize monorepo structure (Section 2.1); scaffold NestJS app with `Core`/`Common` modules, global exception filter, config-validation-at-bootstrap (SYSTEM_ARCHITECTURE.md Section 10.6), `/health`/`/health/ready` endpoints; scaffold Angular app with `core`/`shared`/`layouts` skeleton (FRONTEND_ARCHITECTURE.md Section 2) and Tailwind configured; write `docker-compose.yml` (postgres, redis, backend, frontend, nginx) and local Nginx reverse-proxy config; initialize Prisma, apply the first migration batch (global reference tables — `Role`, `Permission`, `RolePermission`, `Plan`, PRISMA_SCHEMA.md Section 14.2 step 1); write the required seed script (`Role`/`Permission`/`Plan` rows); set up GitHub Actions CI (lint, typecheck, unit test, build); begin WhatsApp Business Account + Meta App verification submission (external lead time, non-blocking).
- **Deliverables:** running local stack; green CI on a trivial PR; seeded database; a documented `local-bootstrap.sh` script (SYSTEM_ARCHITECTURE.md Section 14).
- **Dependencies:** none.
- **Estimated Complexity:** Medium (mostly tooling/config breadth, low logical complexity).
- **Risks:** environment/tooling friction eating more time than expected on a from-scratch setup; Meta's verification process requiring business documentation not yet gathered (start gathering immediately, don't wait for this sprint to surface the need).
- **Acceptance Criteria:** `docker compose up` brings up all services healthy; `prisma migrate deploy` runs clean against a fresh database; CI blocks a PR with a deliberately broken lint rule; WhatsApp verification submitted.
- **Completion notes:** every engineering deliverable above is done and verified (see docs/DECISIONS.md ADR-001) — including `local-bootstrap.sh`, which this list named but an earlier pass had missed until the pre-commit review caught it. **WhatsApp Business Account + Meta App verification submission is a real-world business action outside engineering scope and remains outstanding** — start it before Milestone 6 (WhatsApp Integration) needs it, per Section 1.3's lead-time warning.

### Milestone 2 — Authentication

> **Execution note (docs/adr/ADR-003-core-authentication.md):** Sprints 2.1 and 2.2 below were **not** executed as separately scoped/ordered sprints. Instead, a single "Core Authentication" pass implemented Register/Login/Logout/Refresh/Get-Current-User across both stacks — Sprint 2.1's `Auth module (register, login, logout, refresh with rotation...)`/JWT/password-hashing/rate-limiting tasks and Sprint 2.2's `auth` Angular feature/`AuthStateService`/`AuthInterceptor`/`AuthGuard`/`GuestOnlyGuard` tasks, minus forgot/reset-password, verify-email, the `Users`/`UserRole` modules' CRUD surface, Google OAuth, and invitation-acceptance — all of which were explicitly out of scope for that pass and remain open. See docs/AUTHENTICATION.md for what was actually built and why. The remaining items from both sprints below (struck through in spirit, not literally removed, so the original plan stays visible) should be picked up as a follow-up sprint — recommended numbering **Sprint 2.3** — before Milestone 3 begins, since Sprint 3.1 depends on `Auth`/`Users` being complete.
>
> **Sprint 2.3 execution note (docs/adr/ADR-004-account-security.md):** Completed as "Account Security" — forgot/reset-password, verify-email + resend, Redis-backed login-attempt tracking/temporary lockout, extended security event logging, and refresh-token revocation on password reset. **Google OAuth, invitation-acceptance, and the `Users`/`UserRole` CRUD surface remain explicitly out of scope** (a narrower charter than this note above originally envisioned for "Sprint 2.3") and are still open — Sprint 3.1 should not assume they exist. See docs/AUTHENTICATION.md Section 6a for what was built.

#### Sprint 2.1 — Backend Auth & Users
- **Objectives:** every `Auth`/`Users` endpoint from API_SPECIFICATION.md Section 4–5 working against a real database.
- **Tasks:** `Auth` module (register, login, logout, refresh with rotation, forgot/reset password, verify-email — SYSTEM_ARCHITECTURE.md Section 7.1–7.7); `Users`/`UserRole` modules; JWT strategy (access token) + httpOnly refresh-cookie issuance; password hashing (argon2/bcrypt); minimal `Notifications` module (email-sending capability only, enough to deliver verification/reset emails — full `NotificationTemplate`/`NotificationLog` build-out deferred to Milestone 9); rate limiting on the Public-Sensitive tier (API_SPECIFICATION.md Section 2.10).
- **Deliverables:** all 9 `/auth/*` endpoints + 5 `/users/*` endpoints functioning, covered by integration tests.
- **Dependencies:** Sprint 1.1 (database, base app).
- **Estimated Complexity:** Large (security-sensitive, refresh-rotation logic is genuinely tricky to get right).
- **Risks:** refresh-token rotation/reuse-detection is a common source of subtle bugs (SYSTEM_ARCHITECTURE.md Section 7.2) — budget explicit test time for the reuse-detection path, not just the happy path.
- **Acceptance Criteria:** a registered user can verify their email, log in, have their access token silently refreshed, and log out, with all state changes reflected correctly in `RefreshToken`/`PasswordReset`/`EmailVerification` tables.

#### Sprint 2.2 — Frontend Auth, Google OAuth & Invitations
- **Objectives:** the full Section 5 (FRONTEND_ARCHITECTURE.md) authentication UX, plus Google OAuth and the invitation-acceptance gap closed on both ends.
- **Tasks:** `auth` Angular feature (Login, Register, Forgot/Reset Password, Verify Email pages); `AuthStateService`, `AuthInterceptor`, `AuthGuard`/`GuestOnlyGuard` (FRONTEND_ARCHITECTURE.md Sections 5.6–5.8); Google OAuth backend (`POST /auth/google`) and frontend callback route; **close the invitation-acceptance gap** flagged in API_SPECIFICATION.md Section 18.2 and FRONTEND_ARCHITECTURE.md Section 18.7 — design and implement `POST /auth/accept-invitation` plus its frontend route, since staff onboarding is otherwise incomplete.
- **Deliverables:** a user can complete the entire auth lifecycle through the real UI on staging; an invited staff member can accept an invitation and gain access.
- **Dependencies:** Sprint 2.1.
- **Estimated Complexity:** Medium.
- **Risks:** Google OAuth consent-screen configuration/verification can itself have external review lead time (smaller than WhatsApp's but worth starting early within this sprint, not at the end).
- **Acceptance Criteria:** every route/guard combination in FRONTEND_ARCHITECTURE.md Section 3.2's `/auth/*` rows behaves exactly as specified, including the `GuestOnlyGuard` redirect for an already-authenticated user.

### Milestone 3 — Multi-Tenancy

#### Sprint 3.1 — Tenant Context, RBAC Enforcement & Isolation Proof
- **Objectives:** the tenant-isolation guarantee this entire platform depends on, built once, correctly, and proven with tests — not assumed.
- **Tasks:** `Tenants` module (`Tenant`, `TenantSettings`, `TenantFeature`, `TenantInvitation`); `Core` module's `TenantContextService` (SYSTEM_ARCHITECTURE.md Section 8.3) wired into a base repository pattern every future module will inherit from; `RolesGuard`/`PermissionGuard`/`TenantScopedGuard` (SYSTEM_ARCHITECTURE.md Section 7.3–7.4); update `POST /auth/register` to atomically create `Tenant` + `Owner` `User` + default `TenantSettings` + `TRIALING` `Subscription` in one transaction; implement the composite-foreign-key pattern for cross-tenant-safe relations (PRISMA_SCHEMA.md Section 14.4's DB-R1 resolution) as the template every subsequent tenant-owned module's migrations will follow; `TenantActiveGuard` (backend) skeleton (full plan-limit enforcement lands in Milestone 8, but the guard's structural presence and `TENANT_SUSPENDED`/`402` response start here); onboarding wizard route/shell (frontend, content filled in across Milestones 4–6).
- **Deliverables:** a documented, tested "how to add a new tenant-owned module safely" pattern (repository base class + composite FK template) that every future sprint in Milestones 4–9 follows without re-deriving it.
- **Dependencies:** Sprint 2.1/2.2.
- **Estimated Complexity:** Large — small in raw feature surface, but this is the single highest-leverage correctness sprint in the whole roadmap (Section 1.3); rushing it creates compounding risk across every later milestone.
- **Risks:** DATABASE_DESIGN.md's own Risk DB-R1 is exactly this sprint's central technical challenge — under-investing here is the roadmap's single biggest technical-debt trap; explicitly budget extra review time, not just implementation time.
- **Acceptance Criteria:** an integration test suite proves that Tenant A's authenticated user, via every implemented endpoint, cannot read, list, or mutate Tenant B's data, receiving `404`/`403` exactly as API_SPECIFICATION.md Section 2.3.1 specifies — this test suite is a **permanent, standing regression gate**, re-run in CI for every subsequent PR for the rest of the project (Section 13).

---

### Milestone 4 — Salon Management

#### Sprint 4.1 — Staff & Catalog Backend
- **Objectives:** every piece of structured data the booking engine (Milestone 5) and the AI (Milestone 7) will depend on.
- **Tasks:** `Employees` module (`Employee`, `WorkingHours`, `Holiday`, `EmployeeAvailability`); `Services` module (`ServiceCategory`, `Service`, `EmployeeService`); `BusinessHours` module; **close the file-upload gap** flagged in API_SPECIFICATION.md Section 18.2/FRONTEND_ARCHITECTURE.md Section 18.7 — design and implement `POST /files` (pre-signed S3 upload URL issuance) plus the `Files` module, needed for salon logo upload and, later, WhatsApp media (Milestone 6).
- **Deliverables:** all `Employees`/`Services` CRUD endpoints from API_SPECIFICATION.md Sections 7–8; working S3-compatible file upload flow.
- **Dependencies:** Milestone 3 (every table here is tenant-owned, built on the Sprint 3.1 pattern).
- **Estimated Complexity:** Medium.
- **Risks:** the `EMPLOYEE_HAS_UPCOMING_APPOINTMENTS` guardrail (API_SPECIFICATION.md Section 7) can't be *tested* meaningfully until Appointments exists (Milestone 5) — implement the check now against an empty `Appointment` table, add a regression test for it explicitly once Milestone 5 lands, don't let it be silently forgotten.
- **Acceptance Criteria:** an Owner can create a service, mark an employee eligible for it, and set that employee's weekly working hours, entirely through API calls verified in integration tests (frontend lands in Sprint 4.2).

#### Sprint 4.2 — Customers Backend & Salon Management Frontend
- **Objectives:** complete the Salon Management domain and give it a real UI, closing out the onboarding wizard's data-entry steps.
- **Tasks:** `Customers` module (`Customer`, `CustomerTag`, `CustomerNote`, `CustomerPreference`, `CustomerTagAssignment`); frontend `employees`, `services`, `customers` feature modules (FRONTEND_ARCHITECTURE.md Sections 6.3–6.5) including the `WorkingHours` weekly-schedule editor and `EmployeePicker`/`ServicePicker` domain components (Section 1.6, Tier 2); complete the onboarding wizard (Sprint 3.1's shell) so it walks a new Owner through connecting their first employee and service.
- **Deliverables:** a fully click-through-able Employees/Services/Customers experience on staging; onboarding wizard functionally complete for its pre-WhatsApp/AI steps.
- **Dependencies:** Sprint 4.1.
- **Estimated Complexity:** Medium.
- **Risks:** onboarding-wizard scope creep (it's tempting to make this feel "finished" before WhatsApp/AI steps exist to append to it) — scope this sprint's wizard work strictly to what Milestone 4's data supports, revisit in Milestones 6/7.
- **Acceptance Criteria:** a brand-new tenant can, through the UI alone, add a service, add a staff member, assign the staff member to the service, and see both reflected correctly.

### Milestone 5 — Scheduling Engine

#### Sprint 5.1 — Availability Engine & Booking Conflict Prevention
- **Objectives:** the platform's single most business-critical piece of logic, built correctly the first time.
- **Tasks:** `Availability` module (slot computation against `WorkingHours`/`EmployeeAvailability`/`Holiday`/existing `Appointment`s and `TenantSettings.bookingBufferMinutes`); `Appointments` module (`Appointment`, `AppointmentService` with historical snapshotting per PRISMA_SCHEMA.md Section 7.1, `AppointmentStatusHistory`); implement the **booking-conflict-prevention mechanism exactly as specified in PRISMA_SCHEMA.md Section 14.4** — Redis distributed lock (DATABASE_DESIGN.md Section 10.4) **and** the `btree_gist EXCLUDE` database constraint, both layers, not just one (DATABASE_DESIGN.md Risk DB-R3's resolution); `GET /appointments/availability`.
- **Deliverables:** `POST /appointments`, `GET /appointments/availability`, and the two-layer conflict-prevention mechanism, load-tested specifically for the concurrent-double-booking race condition (a deliberate, scripted concurrency test, not just a unit test of the happy path).
- **Dependencies:** Milestone 4.
- **Estimated Complexity:** Extra-Large — the highest-complexity single sprint in the roadmap; budget accordingly and do not compress it to protect the schedule elsewhere.
- **Risks:** exactly DATABASE_DESIGN.md's Risk DB-R3 — this sprint's core purpose is closing that risk with a tested, not assumed, guarantee; a concurrency bug here is the single worst possible defect class for this product (a double-booked customer is a direct, visible trust failure for the salon).
- **Acceptance Criteria:** a scripted test firing many concurrent booking requests at the same employee/slot results in exactly one success and the rest receiving `409 SLOT_NO_LONGER_AVAILABLE`, verified against the real database and Redis, not mocked.

#### Sprint 5.2 — Reschedule/Cancel, Reminders & Scheduling Frontend
- **Objectives:** complete the booking lifecycle and make it fully usable end to end through the dashboard.
- **Tasks:** `POST /appointments/:id/cancel`, `POST /appointments/:id/reschedule` (the reschedule-chain pattern, DATABASE_DESIGN.md Section 9.2); `AppointmentReminder` scheduling + BullMQ worker (SYSTEM_ARCHITECTURE.md Section 11.5/11.6); `Idempotency-Key` handling (API_SPECIFICATION.md Section 2.13) implemented once, generically, in the backend's idempotency middleware/interceptor — reused by every future idempotency-required endpoint (Milestones 6–8), not reimplemented per module; frontend `appointments` feature (Calendar/List views, `AppointmentForm` drawer, availability integration — FRONTEND_ARCHITECTURE.md Section 6.2).
- **Deliverables:** the full Appointments experience, demoable end to end on staging.
- **Dependencies:** Sprint 5.1.
- **Estimated Complexity:** Large.
- **Risks:** reminder-job scheduling accuracy across DST transitions/timezone edge cases (DATABASE_DESIGN.md Section 1.9's UTC-storage discipline mitigates this structurally, but the *job-scheduling* logic itself — "24 hours before `startTime`" computed correctly across a DST boundary — needs explicit test coverage, not just trust in the storage layer being correct).
- **Acceptance Criteria:** a staff member can book, reschedule, and cancel an appointment entirely through the dashboard UI, with a reminder correctly scheduled and (in a staging environment with a shortened test window) observed to fire.

### Milestone 6 — WhatsApp Integration

#### Sprint 6.1 — Webhook Ingestion, Conversations & Messages
- **Objectives:** a real, working, signature-verified WhatsApp connection with messages flowing into the database.
- **Tasks:** `WhatsAppAccount` connection flow (SYSTEM_ARCHITECTURE.md Section 6.9's verification handshake, API_SPECIFICATION.md Section 11's `GET`/`POST /webhooks/whatsapp`); webhook signature verification; `WebhookEvent` raw-event logging (persisted before processing, SYSTEM_ARCHITECTURE.md Section 6.1); `Conversations`/`Messages`/`MessageStatus` modules; inbound/outbound BullMQ queues (SYSTEM_ARCHITECTURE.md Section 6.4) with idempotency keyed on `whatsappMessageId` (PRISMA_SCHEMA.md Section 8.1).
- **Deliverables:** a real WhatsApp test number (from the Sprint 1.1 verification, hopefully cleared by now — Section 10's risk tracking) delivering a real inbound message into the `messages` table, visible via `GET /messages`.
- **Dependencies:** Milestone 3 (tenant resolution by phone number), Sprint 1.1's external verification process.
- **Estimated Complexity:** Large — first real third-party integration, expect API/webhook-format surprises regardless of how carefully API_SPECIFICATION.md/SYSTEM_ARCHITECTURE.md were designed against Meta's documentation.
- **Risks:** **this sprint's start date is gated by Meta's external verification lead time** (Section 1.3) — if verification is still pending, this sprint's *scope* proceeds using WhatsApp's official test-number sandbox (available pre-verification) so development isn't blocked, with the real-number cutover deferred to whenever verification clears, tracked as a Section 10 risk, not silently absorbed into the schedule.
- **Acceptance Criteria:** sending a WhatsApp message to the connected test number produces a correctly-persisted `Message` row within a few seconds, with `WebhookEvent`'s raw log independently confirming receipt even before processing completes.

#### Sprint 6.2 — Outbound Messaging, Media, Templates & Inbox Frontend
- **Objectives:** two-way, human-operable WhatsApp communication through the dashboard — the full product loop minus AI.
- **Tasks:** `TemplateMessage` registry; `Media` handling (inbound download + S3 storage, outbound upload, SYSTEM_ARCHITECTURE.md Section 6.8); `POST /messages/send` (staff manual reply, with `Idempotency-Key`, reusing Sprint 5.2's generic idempotency mechanism); frontend `conversations` feature — the two-pane inbox, message thread, composer (FRONTEND_ARCHITECTURE.md Section 6.6).
- **Deliverables:** a staff member can view an inbound WhatsApp conversation and reply to it through the dashboard, entirely without AI involvement — this is a genuinely useful, shippable capability on its own (a human-operated WhatsApp inbox), deliberately valuable as a standalone increment even before Milestone 7 adds AI on top.
- **Dependencies:** Sprint 6.1.
- **Estimated Complexity:** Medium-Large.
- **Risks:** the 24-hour customer-service-messaging-window rule (API_SPECIFICATION.md Section 11's `OUTSIDE_MESSAGING_WINDOW`) is easy to get subtly wrong (timezone/boundary edge cases again) — write explicit tests for messages sent right at the window boundary, not just well-within/well-outside it.
- **Acceptance Criteria:** a full manual conversation (inbound question → staff reply → inbound follow-up) is demoable end to end on staging using a real WhatsApp device.

---

### Milestone 7 — AI Assistant

#### Sprint 7.1 — AI Orchestration Foundation & Read-Only Tools
- **Objectives:** OpenAI integration working reliably against real conversation data, starting with the lowest-risk (read-only, non-mutating) capability.
- **Tasks:** `AI` module scaffolding; `PromptVersion` registry; `AIContext` (per-conversation working memory); prompt template authoring (SYSTEM_ARCHITECTURE.md Section 5.1) with tenant-variable interpolation from `TenantSettings`; OpenAI integration using Tool Calling + Structured Outputs (SYSTEM_ARCHITECTURE.md Section 5.3–5.4); first tools implemented: `checkAvailability` and `answerFaq` (`POST /ai/tools/faq`) — deliberately the two **non-destructive** tools first, so the guardrail/validation pattern (SYSTEM_ARCHITECTURE.md Section 5.9) is proven before any tool can mutate real data; internal service-credential auth for `/ai/tools/*` (API_SPECIFICATION.md Section 2.14).
- **Deliverables:** an AI that can correctly answer a real customer's availability/FAQ question over WhatsApp, with zero ability yet to book anything.
- **Dependencies:** Milestones 5 and 6 both complete (this is the AI's first point of contact with real booking data and real WhatsApp transport, per Section 1.1's dependency reasoning).
- **Estimated Complexity:** Large — first LLM-integration sprint, expect iteration on prompt reliability.
- **Risks:** OpenAI response latency/cost under real usage patterns is genuinely hard to predict from documentation alone — this sprint should include real, logged usage against the sandbox WhatsApp number specifically to gather latency/token-cost data informing Milestone 8's plan-limit tuning.
- **Acceptance Criteria:** a real WhatsApp message asking "are you open Saturday?" or "do you have anything free tomorrow?" gets a correct, grounded (never hallucinated) AI response, verified against `TenantSettings`/real availability data, with the interaction fully logged (`Message.promptVersionId`, `AuditLog`).

#### Sprint 7.2 — Booking Tools, Guardrails & Human Handoff
- **Objectives:** the product's complete, defining capability — full AI-driven booking with safety mechanisms proven, not assumed.
- **Tasks:** `POST /ai/tools/book`, `.../reschedule`, `.../cancel` — wired to the exact same `Appointments`/`Availability` logic Milestone 5 built and load-tested, never a parallel/duplicated implementation; confirmation-before-destructive-action guardrail (SYSTEM_ARCHITECTURE.md Section 5.9); `escalateToHuman` tool wired into `Conversation.status` transitions and Milestone 6's inbox (SYSTEM_ARCHITECTURE.md Section 5.8); `ConversationSummary` generation; fallback/degraded-mode handling for OpenAI outages (SYSTEM_ARCHITECTURE.md Section 5.10); dashboard "Test my AI" sandbox (`POST /ai/chat` in `dashboard_test` mode, FRONTEND_ARCHITECTURE.md Section 6.6's AI-context side panel); onboarding wizard's final step (AI configuration + test message) completed.
- **Deliverables:** a real customer, over real WhatsApp, can book, reschedule, or cancel an appointment through natural conversation with the AI, with the AI correctly escalating to a human when it should.
- **Dependencies:** Sprint 7.1.
- **Estimated Complexity:** Extra-Large — this is the product's core value proposition; treat guardrail testing (an AI attempting to book a non-existent service, an AI attempting to double-book, an AI misreading intent) as first-class acceptance criteria, not an afterthought to the happy path.
- **Risks:** hallucinated/incorrect AI booking actions are this project's single highest-consequence product risk (PROJECT_REQUIREMENTS.md Section 17, Risk R2/SYSTEM_ARCHITECTURE.md Risk R2) — this sprint's guardrail work is exactly that risk's mitigation and should not be compressed under schedule pressure; if a choice must be made, ship the human-handoff fallback broadly rather than a booking tool with unproven guardrails.
- **Acceptance Criteria:** a scripted adversarial test set (ambiguous requests, requests for non-existent services, rapid-fire conflicting messages) all resolve safely — either a correct booking, a graceful clarifying question, or an escalation to human — with zero incidents of an incorrect booking being silently created.

### Milestone 8 — Billing

#### Sprint 8.1 — Stripe Integration & Plan Enforcement
- **Objectives:** the platform can accept real payment and enforce real plan limits.
- **Tasks:** `Plan`/`Subscription`/`Invoice`/`Payment`/`Coupon` modules; Stripe Checkout session creation (`POST /subscriptions`); Stripe webhook handling + signature verification (`POST /stripe/webhook`, `WebhookLog`); usage-limit enforcement wired into the AI module's rate limiting (`messagesUsedCurrentPeriod`, FR-22) — connecting Milestone 7's AI usage directly to this sprint's billing state, closing the loop SYSTEM_ARCHITECTURE.md Section 5.7 flagged as a cost-control necessity.
- **Deliverables:** a tenant can subscribe to a real (Stripe test-mode) plan and have their AI usage correctly capped and tracked against it.
- **Dependencies:** Milestone 3 (Subscription already exists in `TRIALING` state from registration), Milestone 7 (usage tracking has something real to meter).
- **Estimated Complexity:** Large — Stripe's test-mode-vs-live-mode behavioral differences are a known source of late-discovered bugs (Section 10); budget explicit live-mode-configuration verification time even though this sprint runs in test mode.
- **Risks:** Stripe webhook event ordering/idempotency edge cases (a subscription-updated event arriving before or after its corresponding payment event) — test against Stripe's CLI-based webhook-replay tooling, not just manual test-mode clicking.
- **Acceptance Criteria:** a full Stripe test-mode checkout flow completes, the resulting webhook correctly updates `Subscription.status`, and exceeding the plan's `maxMessagesPerMonth` correctly blocks further AI responses with a clear, tenant-visible reason.

#### Sprint 8.2 — Dunning, Billing Frontend & Tenant-Suspension Enforcement
- **Objectives:** the complete billing lifecycle, including the unhappy paths, fully enforced across the whole application.
- **Tasks:** dunning flow (failed-payment `Notification`, retry-window handling, FR-25); frontend `billing` feature (plan comparison, Stripe Checkout redirect, invoice history — FRONTEND_ARCHITECTURE.md Section 6.8); `TenantActiveGuard` full enforcement verified across **every** `/app/*` route (not just billing) per FRONTEND_ARCHITECTURE.md Section 3.3's exemption-for-billing-page rule; trial-expiry handling (`Tenant.trialEndsAt` reached with no payment method attached).
- **Deliverables:** the complete subscription lifecycle (PROJECT_REQUIREMENTS.md Section 14.6's user journey) working end to end, including a tenant correctly getting blocked and correctly getting unblocked.
- **Dependencies:** Sprint 8.1.
- **Estimated Complexity:** Medium-Large.
- **Risks:** the persistent past-due banner (FRONTEND_ARCHITECTURE.md Section 6.8) and the route-level suspension redirect (Section 3.3) are two separate mechanisms that must agree with each other and with the backend's `402 TENANT_SUSPENDED` — test the full matrix of states (`TRIALING`/`ACTIVE`/`PAST_DUE`/`SUSPENDED`/`CANCELED`) against both frontend and backend behavior together, not each in isolation.
- **Acceptance Criteria:** simulating a failed payment (via Stripe test-mode) correctly triggers the dunning notification, then correctly blocks AI/booking actions while leaving `/app/billing` reachable, then correctly restores full access on a successful retry payment.

### Milestone 9 — Analytics, Notifications & Admin

#### Sprint 9.1 — Dashboard Aggregation, Audit Trail Completion & Notifications
- **Objectives:** surface the data the whole system has been generating since Milestone 3, and retroactively verify audit logging is actually complete.
- **Tasks:** `Dashboard`/`Analytics` endpoints (composition-only, no new write paths, SYSTEM_ARCHITECTURE.md Section 3.2); **an explicit audit pass** verifying every business-significant mutation across Milestones 3–8 (`Appointment` status changes, `TenantSettings` changes, `Subscription` changes, `User` role changes) actually writes a correct `AuditLog` row — closing any gaps that were deferred or missed during the feature sprints that built those mutations (an intentional, scheduled cleanup point, not a hope that every prior sprint got this perfectly right the first time); `NotificationTemplate`/`Notification`/`NotificationLog` modules completed (Sprint 2.1 built only the minimal email-sending capability; this sprint builds the full templated, logged notification system) covering payment-failure, invitation, and weekly-summary notifications.
- **Deliverables:** `GET /dashboard`, `GET /analytics` returning real, correct aggregate data; a verified-complete audit trail; a real, templated notification system.
- **Dependencies:** Milestones 3–8 (this milestone is deliberately, entirely derivative of prior data).
- **Estimated Complexity:** Medium — the audit-completeness verification task is more valuable than it is technically hard, and should not be rushed past.
- **Risks:** discovering an audit-logging gap this late means retrofitting a fix into an already-shipped module (Sprint 3.1's very warning about retrofitting cost) — mitigated by having flagged the requirement clearly in every relevant sprint above, but this sprint is the deliberate, scheduled backstop if any were missed.
- **Acceptance Criteria:** a Super Admin (once Sprint 9.2 lands the console) or a direct database query can reconstruct a complete, correct history of any given appointment or subscription purely from `AuditLog`/`AppointmentStatusHistory`.

#### Sprint 9.2 — Reports, Frontend & Super Admin Console
- **Objectives:** close out the last user-facing feature surfaces before production hardening begins.
- **Tasks:** `GET /reports` (async export job via BullMQ, SYSTEM_ARCHITECTURE.md Section 11.5); frontend `dashboard-home`, `analytics`, `notifications` feature modules (FRONTEND_ARCHITECTURE.md Sections 6.1, 6.7, 6.11); `Admin` backend module (`GET /admin/users`, `/admin/tenants`, `/admin/system`, structurally isolated per SYSTEM_ARCHITECTURE.md Section 8.4's "never a shared code path with tenant-scoped roles" rule); frontend `admin` feature module + `AdminLayout` (FRONTEND_ARCHITECTURE.md Sections 4.3, 6).
- **Deliverables:** the complete MVP feature set (PROJECT_REQUIREMENTS.md Section 12) fully implemented and demoable.
- **Dependencies:** Sprint 9.1.
- **Estimated Complexity:** Medium-Large.
- **Risks:** the Admin console is the one part of the app with a genuinely different security model (no tenant scoping at all) — treat its authorization tests with the same rigor as Sprint 3.1's tenant-isolation suite, since a bug here has the same class of consequence (cross-tenant data exposure) via a different mechanism (role escalation instead of missing tenant filter).
- **Acceptance Criteria:** a Super Admin can view cross-tenant data through `/admin/*`; a `SUPER_ADMIN`-role token is verified, via a dedicated test suite, to be rejected by every tenant-scoped endpoint, and a tenant-scoped role's token is verified to be rejected by every `/admin/*` endpoint — the separation is bidirectionally proven, not assumed.

### Milestone 10 — Production Deployment

#### Sprint 10.1 — Hardening, Security & Performance
- **Objectives:** verify the system is actually production-ready, not just feature-complete.
- **Tasks:** full OWASP-checklist security review (SYSTEM_ARCHITECTURE.md Section 9.1) — dependency vulnerability scan, header verification, injection/XSS spot-checks, secrets-management audit; load/performance testing of the booking-critical path (Sprint 5.1's concurrency test, re-run at higher scale) and AI response latency under realistic concurrent-conversation load; Hetzner VPS provisioning; production `docker-compose.prod.yml` + Nginx TLS (Let's Encrypt, SYSTEM_ARCHITECTURE.md Section 10.4); automated backup configuration + a **real, executed restore drill** (DATABASE_DESIGN.md Section 10.7's requirement that restoration be tested, not taken on faith); monitoring/alerting (error tracking, infra metrics, SYSTEM_ARCHITECTURE.md Section 10.8) wired to a real alert channel.
- **Deliverables:** a production-configured, security-reviewed, load-tested, monitored environment, distinct from staging, ready for real traffic.
- **Dependencies:** Milestone 9 (feature-complete system to actually test).
- **Estimated Complexity:** Large — breadth across many non-functional concerns, each individually moderate but collectively substantial.
- **Risks:** a restore drill that's skipped "because backups are obviously working" is exactly the kind of assumption that fails silently until the one time it matters — this task is non-negotiable, not a nice-to-have.
- **Acceptance Criteria:** a full backup-then-restore cycle is executed against a copy of the production database and verified byte-correct; a security scan report shows no unresolved high/critical findings; the booking-conflict concurrency test passes at 10x Sprint 5.1's original test load.

#### Sprint 10.2 — Go-Live
- **Objectives:** a real salon, live, on the real platform.
- **Tasks:** production data migration dry-run (empty-database migration verified against the exact production migration order, PRISMA_SCHEMA.md Section 14.2); finalize real WhatsApp Business number cutover (contingent on Sprint 6.1's verification having cleared by now — Section 10 tracks this explicitly); execute a go-live checklist (DNS, TLS certificate validity, environment variable audit, monitoring dashboards live); onboard one real pilot tenant; a defined post-launch monitoring window (active, elevated attention for the first 1–2 weeks of real traffic, not a "ship and walk away" moment); finalize all six prior documents to reflect their final as-built state (Section 8).
- **Deliverables:** a real, paying (or trial) salon successfully using the live product; all documentation current.
- **Dependencies:** Sprint 10.1.
- **Estimated Complexity:** Medium (the hard technical work is done; this sprint is about careful, deliberate execution and observation, not new engineering).
- **Risks:** the very first real tenant will surface UX/edge-case issues no amount of internal testing catches — budget explicit reactive-fix capacity in the days immediately following go-live rather than treating the roadmap as "finished" the moment the pilot tenant signs up.
- **Acceptance Criteria:** the pilot tenant successfully receives, books, and manages at least one real AI-driven WhatsApp appointment in production, with zero P0/P1 incidents in the first week.

---

## 5. Backend Module Order

Restating SYSTEM_ARCHITECTURE.md Section 3.3's dependency graph as a **build sequence**, cross-referenced to the sprint that delivers each:

| Order | Module | Sprint | Why This Position |
|---|---|---|---|
| 1 | `Core` / `Common` | 1.1 | Every other module depends on the tenant-context, guard, and exception-handling foundation living here (SYSTEM_ARCHITECTURE.md Section 3.2) — literally cannot build anything else first. |
| 2 | `Auth` | 2.1 | Nothing tenant-scoped can be tested without an authenticated identity to test it as. |
| 3 | `Users` | 2.1 | Direct dependency of `Auth` (login resolves to a `User`) and `Tenants` (a tenant's `Owner` is a `User`). |
| 4 | `Tenants` | 3.1 | The multi-tenancy root every subsequent module's `tenantId` foreign key points at (Section 1.1's foundational-risk reasoning). |
| 5 | `Employees` | 4.1 | First tenant-owned domain module, and a direct dependency of `Services` (eligibility) and `Availability` (scheduling). |
| 6 | `Services` | 4.1 | Depends on `Employees` (`EmployeeService` eligibility); direct dependency of `Appointments`. |
| 7 | `Files` | 4.1 | Needed by `Tenants` (`logoFileId`) and, later, `WhatsApp`'s `Media` — built once its own dependency (`Tenants`) exists, ahead of its consumers. |
| 8 | `Customers` | 4.2 | Depends on `Tenants`; direct dependency of `Appointments` and `Conversations`. |
| 9 | `Availability` | 5.1 | Depends on `Employees`/`Services`/existing `Appointments`; must exist before `Appointments` can enforce conflict prevention. |
| 10 | `Appointments` | 5.1–5.2 | The core scheduling engine — depends on `Customers`/`Employees`/`Services`/`Availability`, all of which now exist. |
| 11 | `WhatsApp` | 6.1–6.2 | Depends on `Tenants` (number-to-tenant resolution) and `Customers` (`findOrCreateByPhone`); its `Media` sub-concern depends on `Files`. |
| 12 | `Conversations` / `Messages` | 6.1–6.2 | Depend on `WhatsApp`'s transport layer and `Customers`. |
| 13 | `AI` | 7.1–7.2 | The last module to be built precisely because it depends on **all** of `Appointments`, `Availability`, `Services`, `Employees`, `Customers`, `Conversations`, and `WhatsApp` being real and working (SYSTEM_ARCHITECTURE.md Section 5.3) — building it earlier would mean building against stubs. |
| 14 | `Billing` | 8.1–8.2 | Depends on `Tenants`; deliberately sequenced after the product has real value to sell (Section 1.1) even though it has no *technical* dependency on `AI`/`WhatsApp`. |
| 15 | `Notifications` (full build-out) | 9.1 | Depends on `Users`/`Billing`(failure events)/`Tenants`(invitations) — its minimal email-sending capability was pulled forward to Sprint 2.1 as a dependency of `Auth`'s verification flow, a deliberate, documented exception to strict dependency ordering (small, low-risk, unblocks Milestone 2). |
| 16 | `Dashboard` / `Analytics` | 9.1 | Purely compositional (SYSTEM_ARCHITECTURE.md Section 3.2) — cannot meaningfully exist before the modules it composes from (`Appointments`, `Conversations`, `Billing`) do. |
| 17 | `Admin` | 9.2 | Deliberately last among functional modules — cross-tenant by design, built once every tenant-scoped module it needs to oversee already exists and is stable. |
| 18 | `AuditLogs` / `ActivityLog` (as a cross-cutting concern) | Incrementally, every sprint from 3.1 onward; verified complete in 9.1 | Not a single-sprint module — every module from `Tenants` onward is required to write its own audit entries as it's built (SYSTEM_ARCHITECTURE.md Section 9.6), with Sprint 9.1 serving as the scheduled completeness audit, not the first time audit logging is considered. |

---

## 6. Frontend Module Order

Restating FRONTEND_ARCHITECTURE.md Section 18.5's 14 lazy-loaded feature modules as a build sequence, mirroring Section 5's backend order exactly (each frontend feature is built in the same sprint as, or the sprint immediately following, its backing API):

| Order | Feature Module | Sprint | Why This Position |
|---|---|---|---|
| 1 | `auth` | 2.2 | First frontend surface a user ever sees; depends only on the `Auth` API (Sprint 2.1). |
| 2 | `onboarding` | 2.2 (shell) → 4.2 (data steps) → 7.2 (AI step) | Built incrementally alongside whichever backend capability its current step configures — deliberately the one feature module *not* built in one sprint, since its purpose is literally to walk through the others in sequence. |
| 3 | `employees` | 4.2 | Depends on the `Employees` API (Sprint 4.1). |
| 4 | `services` | 4.2 | Depends on the `Services` API (Sprint 4.1); built alongside `employees` since both power the same onboarding steps and share the `EmployeePicker`/`ServicePicker` domain components (FRONTEND_ARCHITECTURE.md Section 1.6). |
| 5 | `customers` | 4.2 | Depends on the `Customers` API (Sprint 4.2). |
| 6 | `appointments` | 5.2 | Depends on `Appointments`/`Availability` (Sprint 5.1) — the single largest, most interaction-rich feature module (calendar, drawer-based booking form), matching its backend's own Extra-Large complexity rating. |
| 7 | `conversations` | 6.2 | Depends on `Conversations`/`Messages`/`WhatsApp` (Sprint 6.1) — includes the AI-context side panel built in anticipation of, but functional ahead of, Milestone 7's AI module actually populating it. |
| 8 | `billing` | 8.2 | Depends on `Billing`/Stripe integration (Sprint 8.1); the `TenantActiveGuard` this module's routing depends on (FRONTEND_ARCHITECTURE.md Section 3.3) was structurally built back in Sprint 3.1, activated fully here. |
| 9 | `dashboard-home` | 9.2 | Compositional, depends on `Dashboard` API (Sprint 9.1) — deliberately one of the last feature modules despite being the first *page* a logged-in user sees, since it has nothing real to aggregate until the modules it summarizes exist. |
| 10 | `analytics` | 9.2 | Same reasoning as `dashboard-home`, one sprint later since it depends on a larger backing dataset (`GET /analytics`'s date-range trend data) to be meaningfully testable. |
| 11 | `notifications` | 9.2 | Depends on the full `Notifications` build-out (Sprint 9.1) rather than Sprint 2.1's minimal email-only version. |
| 12 | `settings` | 3.1 (tenant profile) → 6.9/Milestone 4 (AI behavior fields, populated once `TenantSettings` fields have real consumers) | Built incrementally like `onboarding` — the `Tenant`/`TenantSettings` API exists from Sprint 3.1, but fields like `aiGreetingMessage` are only meaningfully editable once Milestone 7's AI actually reads them. |
| 13 | `profile` | 2.2 | Depends only on `Auth`/`Users` (Sprint 2.1) — built early since it's a small, low-risk module and a natural pairing with the auth work already in flight that sprint. |
| 14 | `admin` | 9.2 | Last, matching its backend's own last-built position (Section 5) — deliberately never built alongside any tenant-scoped feature module, keeping its bundle and its authorization model cleanly separate throughout development, not just at the architecture-document level (FRONTEND_ARCHITECTURE.md Section 14.2). |

---

## 7. Testing Strategy

### 7.1 Testing Pyramid (Applied Throughout)

Standard pyramid discipline, matching SYSTEM_ARCHITECTURE.md Section 14's `test/unit`/`test/integration`/`test/e2e` folder structure: **many** fast unit tests (domain logic, validators, pure utility functions — run on every save), **fewer** integration tests (a module's service layer against a real, ephemeral test database and Redis instance — run on every PR), **fewest** end-to-end tests (full user journeys through a real browser against a running staging-equivalent stack — run before every milestone release, not on every commit, since they're the slowest and most brittle layer). No milestone is considered complete without all three layers represented, per the table below.

### 7.2 Per-Milestone Testing Focus

| Milestone | Unit Tests | Integration Tests | E2E Tests | Manual QA | Performance Testing | Security Testing |
|---|---|---|---|---|---|---|
| **1. Foundation** | Config-validation logic | Docker Compose service connectivity (Postgres/Redis reachable) | N/A (nothing to click through yet) | Local stack walkthrough | N/A | Verify no default credentials committed; secrets excluded from git |
| **2. Authentication** | Password hashing, token generation, validators | Full auth-flow endpoints against a test DB (register→verify→login→refresh→logout) | Register → verify email → log in → log out, through a real browser | Manual Google OAuth click-through (hard to fully automate) | Login endpoint under moderate concurrent load (brute-force-adjacent rate-limit verification) | Refresh-token reuse-detection attack simulation; rate-limit bypass attempts |
| **3. Multi-Tenancy** | `TenantContextService` resolution logic | **The standing cross-tenant-isolation suite** (Section 4, Sprint 3.1) — the single most important integration test suite in the project | Two-tenant walkthrough confirming visual/data separation | Manual attempt to guess/enumerate another tenant's resource IDs | N/A | Explicit IDOR/cross-tenant-access penetration testing |
| **4. Salon Management** | DTO validation rules (duration/price bounds, phone format) | CRUD endpoints per module against test DB; file-upload flow against a test S3 bucket | Owner configures a service + employee + customer, full click-through | Onboarding-wizard usability pass | N/A | File-upload content-type/size validation abuse testing |
| **5. Scheduling Engine** | Availability-computation logic (working hours + holidays + buffers) | **Concurrency test** (Section 4, Sprint 5.1) — scripted parallel booking-conflict test against real Postgres + Redis | Book → reschedule → cancel, full click-through | Manual verification of reminder timing across a DST boundary date | **Load test the booking-critical path specifically** (SYSTEM_ARCHITECTURE.md's Critical NFR) | Authorization-scoping test (Staff cannot act on another employee's appointment) |
| **6. WhatsApp Integration** | Webhook payload normalization logic | Webhook signature verification (valid/invalid/replayed payloads); idempotency-dedup test (same `whatsappMessageId` twice) | Real WhatsApp device round-trip (send message, see it in dashboard, reply, see it delivered) | Manual real-device testing across at least two WhatsApp client versions (iOS/Android) | Webhook burst-handling test (many rapid inbound events) | Signature-forgery rejection test; media-upload content-type validation |
| **7. AI Assistant** | Prompt-template variable interpolation, guardrail validation functions | Tool-call execution against real `Appointments`/`Availability` (never mocked, per Section 4 Sprint 7.2) | Full real-WhatsApp AI booking conversation, multiple scenarios (happy path, ambiguous request, escalation) | **Adversarial manual testing** — an explicit, scripted attempt to confuse/mislead the AI into an incorrect action | AI response-latency measurement under concurrent conversations | Guardrail-bypass adversarial testing (hallucination/injection attempts via crafted customer messages) |
| **8. Billing** | Plan-limit calculation logic | Stripe webhook handling via Stripe CLI event replay (including out-of-order delivery) | Full Stripe Checkout test-mode flow, subscription change, invoice view | Manual dunning-flow walkthrough (simulate failed card in Stripe test mode) | N/A | Webhook signature-forgery rejection test (mirroring Milestone 6's WhatsApp equivalent) |
| **9. Analytics, Notifications & Admin** | Aggregation/formatting logic | `Admin` cross-tenant read verified; tenant-scoped-token-rejected-by-admin-endpoint verified (bidirectional, Section 4 Sprint 9.2) | Dashboard/Analytics render correctly with real seeded data; Admin console walkthrough | Manual audit-log completeness spot-check against Section 4 Sprint 9.1's audit pass | Dashboard/Analytics query performance against a realistically-sized seeded dataset | Admin-role-escalation attempt test (a `STAFF` token attempting any `/admin/*` call) |
| **10. Production Deployment** | N/A (no new logic) | Full regression run of every prior milestone's integration suite against the production-configured stack | Full regression run of every prior milestone's E2E suite against staging | **Backup/restore drill** (Section 4 Sprint 10.1); go-live checklist execution | **Full load test** at realistic multi-tenant concurrent scale; the Milestone 5 concurrency test re-run at 10x | **Full OWASP-checklist security review**; dependency vulnerability scan; TLS/header verification against the live domain |

---

## 8. Documentation Plan

### 8.1 Living-Document Policy

The six documents preceding this one are **not archived artifacts** — they are the system's source of truth throughout implementation, and this project operates under a **hard rule, enforced at the PR level (Section 2.5)**: any implementation decision that deviates from, refines, or extends what a source document specifies must update that document **in the same pull request**, never as a deferred follow-up. A schema change without a corresponding PRISMA_SCHEMA.md/DATABASE_DESIGN.md update, or an API change without a corresponding API_SPECIFICATION.md update, is treated as an incomplete PR, full stop (Section 13's Quality Gates operationalize this).

### 8.2 Per-Milestone Documentation Touchpoints

| Milestone | Documents Updated | What Changes |
|---|---|---|
| 1. Foundation | SYSTEM_ARCHITECTURE.md (if infra specifics evolve during setup); new: `README.md`, `docs/runbooks/local-setup.md` | Any deviation from the documented Docker Compose/CI design discovered during actual setup. |
| 2. Authentication | API_SPECIFICATION.md (if any auth endpoint's actual behavior needed refinement) | Rare — this milestone should mostly confirm the existing spec, not change it. |
| 3. Multi-Tenancy | PRISMA_SCHEMA.md (composite-FK implementation specifics, Section 14.4's resolution finalized), DATABASE_DESIGN.md (Risk DB-R1 marked closed) | The two documents most directly implicated by this milestone's core work get their "open risk" flags resolved to "closed, implemented as follows." |
| 4. Salon Management | API_SPECIFICATION.md (add `POST /files` and any `ServiceCategory` endpoints — closing Section 18.2's flagged gaps with the actual, now-real contract) | The gap-closure endpoints get properly specified, not just implemented ad hoc. |
| 5. Scheduling Engine | DATABASE_DESIGN.md (Risk DB-R3 marked closed, `EXCLUDE` constraint documented as implemented), PRISMA_SCHEMA.md (any refinement to the conflict-prevention migration) | |
| 6. WhatsApp Integration | SYSTEM_ARCHITECTURE.md (any refinement to the webhook/queue design based on real Meta API behavior encountered) | Third-party integrations are the most likely place reality diverges from documentation-stage assumptions — this is expected, and the doc is updated to match reality, not treated as wrong. |
| 7. AI Assistant | SYSTEM_ARCHITECTURE.md (prompt versioning specifics, guardrail implementation details refined against real OpenAI behavior) | |
| 8. Billing | API_SPECIFICATION.md (any Stripe-webhook-driven refinement) | |
| 9. Analytics, Notifications & Admin | API_SPECIFICATION.md (`ServiceCategory` if not closed earlier; any Admin-endpoint refinement) | |
| 10. Production Deployment | **All six documents reviewed and finalized to as-built status**; new: `CHANGELOG.md` (full history), `docs/runbooks/` (deploy, rollback, incident-response, backup-restore) | The formal "documentation matches reality" checkpoint before go-live — not the first time documents are touched, but the point where they're verified complete. |

### 8.3 New Documents Introduced During Implementation

- `README.md` (Milestone 1) — project overview, local setup instructions, links to all architecture documents.
- `CHANGELOG.md` (Milestone 1, populated continuously per Section 2.7) — release history.
- `docs/runbooks/` (populated incrementally, finalized Milestone 10) — deploy procedure, rollback procedure, incident response, backup/restore procedure, WhatsApp/Stripe webhook-debugging guide.
- `docs/adr/` (Architecture Decision Records, as flagged in SYSTEM_ARCHITECTURE.md Section 14's folder structure) — one short record per significant deviation from the six source documents, created whenever Section 8.1's living-document policy triggers a non-trivial change, giving future readers the *why* behind a divergence without needing to reconstruct it from git history alone.

---

## 9. Definition of Done

A feature (a sprint task, Section 4) is **not** done until every item below is true — this checklist is the concrete, mechanical form of every principle stated elsewhere in this document, and is what Section 2.6's self-review and Section 13's quality gates check against directly.

**Code**
- [ ] Implements exactly the scope of its linked sprint task — no unrelated changes bundled in (Section 2.5).
- [ ] Follows Section 12's coding standards (naming, folder placement, DI patterns).
- [ ] No `TODO`/commented-out code merged to `main` without an accompanying tracked follow-up task.
- [ ] Any deviation from PRISMA_SCHEMA.md/API_SPECIFICATION.md/FRONTEND_ARCHITECTURE.md is reflected back into that document in the same PR (Section 8.1).

**Tests**
- [ ] Unit tests cover new business logic (Section 7.1's pyramid).
- [ ] Integration tests cover new API endpoints/database interactions, including at least one failure-path test (not just the happy path).
- [ ] If the feature touches tenant-scoped data, the cross-tenant-isolation suite (Section 4, Sprint 3.1) still passes unmodified — a new feature is never allowed to weaken this suite to make itself pass.
- [ ] E2E coverage added or updated if the feature changes a user-facing flow.

**Documentation**
- [ ] Source-of-truth documents updated per Section 8.1/8.2.
- [ ] Any new environment variable documented in `.env.example` (SYSTEM_ARCHITECTURE.md Section 10.6).
- [ ] An ADR added if the change constitutes a meaningful architectural deviation (Section 8.3).

**Performance**
- [ ] No new N+1 query pattern introduced (verified via query-count assertion in the integration test, or manual query-log review for complex cases).
- [ ] New database queries against tenant-owned tables use the `tenant_id`-leading indexes already defined in PRISMA_SCHEMA.md — never a query pattern requiring a new, undocumented index added silently.
- [ ] Frontend: no regression against the bundle-size budgets configured in `angular.json` (FRONTEND_ARCHITECTURE.md Section 14.7).

**Security**
- [ ] Every new endpoint has explicit, tested authorization (role/permission/tenant-scope) — never "authorization added later."
- [ ] Every new user-input field is validated server-side (never trusting frontend validation alone, API_SPECIFICATION.md/SYSTEM_ARCHITECTURE.md Section 9.3).
- [ ] No secret, credential, or PII logged in plaintext (SYSTEM_ARCHITECTURE.md Section 9.5, FRONTEND_ARCHITECTURE.md Section 17.5).

**Accessibility** *(frontend features only)*
- [ ] Meets FRONTEND_ARCHITECTURE.md Section 12's WCAG 2.2 AA bar — keyboard-operable, correctly labeled, focus-managed.
- [ ] Uses the shared component library (FRONTEND_ARCHITECTURE.md Section 7) rather than a bespoke, unreviewed interactive element.

**Review**
- [ ] Passed an independent AI review pass (Section 2.6).
- [ ] Passed the developer's own Definition-of-Done self-review checklist.
- [ ] All Section 13 Quality Gates green in CI before merge.

---

## 10. Risks

Implementation/delivery risks specifically — distinct from, and additional to, the architecture-level risks already cataloged in PROJECT_REQUIREMENTS.md Section 17, SYSTEM_ARCHITECTURE.md Section 13, and DATABASE_DESIGN.md Section 13 (all of which remain in force and are cross-referenced throughout Section 4's sprints, not repeated here).

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| IR-1 | **WhatsApp Business Account verification delay** (Meta's external review, days to weeks, outside developer control) | High — could block Milestone 6/10's real-number cutover | Submitted in Sprint 1.1, tracked continuously, sandbox-number development path (Section 4, Sprint 6.1) keeps the critical path unblocked regardless of verification timing. |
| IR-2 | **Solo-developer bus factor** (this roadmap assumes one primary developer, Section 11) | High — any extended unavailability stalls the entire project | Documentation-as-you-go discipline (Section 8) and Conventional Commits (Section 2.4) ensure a second person (or a fresh AI-assisted session with no prior context) could resume work from the documents alone, not tribal knowledge. |
| IR-3 | **Scope creep via "future-ready" fields already in the schema** (`Branch`/`Room`, PRISMA_SCHEMA.md Section 5.1) | Medium — tempting to "finish" a table already sitting there | Section 1.5's explicit, restated scope boundary; any PR touching `Branch`/`Room` outside an approved scope change is a Section 13 review failure. |
| IR-4 | **OpenAI API cost/behavior drift during development** (prompt iteration burning real API spend before Milestone 8's usage tracking exists) | Medium — a real, if bounded, cost risk during Milestones 7 | Set a hard development-phase OpenAI spend alert/cap independent of the production billing system; Sprint 7.1 explicitly gathers real cost data specifically to inform Milestone 8's plan-limit tuning, turning a risk into planned learning. |
| IR-5 | **Stripe test-mode/live-mode behavioral divergence** (Section 4, Sprint 8.1) | Medium — a common, well-documented class of late-discovered billing bug | Explicit live-mode-configuration verification task in Sprint 8.1 even though development runs in test mode; Stripe CLI webhook-replay testing rather than manual-only testing. |
| IR-6 | **Booking-conflict-prevention regression** introduced by a later, unrelated change (any module touching `Appointment` after Milestone 5) | Critical — this is the platform's single worst possible defect class (Section 4, Sprint 5.1) | The Sprint 5.1 concurrency test becomes a **standing, permanent CI regression gate** (mirroring Sprint 3.1's tenant-isolation suite) — re-run on every PR touching the `Appointments` module for the rest of the project, not just once. |
| IR-7 | **Tenant-isolation regression** introduced by a later module not following the Sprint 3.1 base-repository pattern | Critical | Same standing-regression-gate treatment as IR-6, applied to Sprint 3.1's isolation suite; Section 12's coding standards make the base-repository pattern the only sanctioned way to write a tenant-scoped query, structurally discouraging a bypass. |
| IR-8 | **Documentation drift** (the six source documents silently falling out of sync with the real, implemented system) | Medium — compounds over time, eventually undermining the entire documentation-first approach this project is built on | Section 8.1's hard PR-level policy, enforced as a literal Section 13 quality gate, not just a stated intention. |
| IR-9 | **Timezone/DST edge-case bugs** (reminders, availability, booking windows — flagged repeatedly across Sprints 5.2, 6.2) | Medium — subtle, hard-to-notice-until-a-customer-complains class of bug | Explicit DST-boundary test cases required wherever a sprint's acceptance criteria already calls this out (Section 4); DATABASE_DESIGN.md Section 1.9's UTC-storage discipline is the structural mitigation, but the *scheduling logic* built atop it still needs its own tests. |
| IR-10 | **AI guardrail bypass leading to an incorrect real-world booking action** (the platform's top product-trust risk) | Critical | Sprint 7.2's adversarial test set is a **standing regression suite**, re-run on every subsequent change to the `AI` module's tools, prompts, or guardrail logic — treated with the same permanence as IR-6/IR-7. |
| IR-11 | **Third-party API breaking changes** (Meta WhatsApp Cloud API, OpenAI API, Stripe API each version independently) | Medium — outside this project's control, can surface at any point post-launch | Pin API versions explicitly where each provider supports it; Milestone 10's monitoring/alerting (Sprint 10.1) is configured to surface integration error-rate spikes quickly, treating "detect fast" as the primary mitigation for a risk that can't be eliminated outright. |

---

## 11. Estimated Timeline

### 11.1 Assumptions

**One experienced full-stack developer, working with AI-assisted development sessions** (the same collaborative model this document itself was produced under) — not a team. "AI-assisted" here means meaningfully faster implementation of well-specified work (this roadmap's entire purpose is to make every sprint's work well-specified, per Section 1) but does **not** mean faster external lead times (Section 10's IR-1), faster genuine design decision-making on ambiguous product questions, or a substitute for the developer's own testing/review discipline (Section 9).

### 11.2 Per-Milestone Estimates

| Milestone | Sprints | Optimistic | Expected | Conservative |
|---|---|---|---|---|
| 1. Foundation | 1 | 3 days | 5 days | 8 days |
| 2. Authentication | 2 | 6 days | 9 days | 14 days |
| 3. Multi-Tenancy | 1 | 4 days | 6 days | 10 days |
| 4. Salon Management | 2 | 6 days | 9 days | 14 days |
| 5. Scheduling Engine | 2 | 8 days | 12 days | 18 days |
| 6. WhatsApp Integration | 2 | 7 days | 11 days | 18 days *(includes IR-1 buffer)* |
| 7. AI Assistant | 2 | 8 days | 13 days | 20 days |
| 8. Billing | 2 | 6 days | 9 days | 14 days |
| 9. Analytics, Notifications & Admin | 2 | 6 days | 9 days | 14 days |
| 10. Production Deployment | 2 | 5 days | 8 days | 12 days |
| **Total (working days)** | **18** | **~59 days** | **~91 days** | **~142 days** |
| **Total (calendar time, 5-day weeks, ~85% focus-time realism factor)** | | **~14 weeks (~3.2 months)** | **~21 weeks (~5 months)** | **~33 weeks (~7.6 months)** |

### 11.3 Reading This Table

- **Optimistic** assumes every sprint's design was correctly anticipated by the six prior documents with minimal rework, no significant AI-integration or third-party-API surprises, and no external lead-time blocking (best-case IR-1/IR-5/IR-11).
- **Expected** assumes the normal, realistic amount of iteration every sprint in Section 4 already anticipates in its own risk notes — this is the planning baseline this roadmap is built around, not a stretch goal.
- **Conservative** assumes at least one meaningful surprise per milestone (a third-party API quirk, a guardrail requiring more iteration than expected, a concurrency bug requiring rework) plus the full WhatsApp-verification lead time landing on the critical path rather than resolving in parallel (IR-1's worst case).
- **Milestone 6 and 7 carry this roadmap's widest optimistic-to-conservative spread**, deliberately — they are simultaneously the highest-technical-complexity milestones (Section 4's own "Extra-Large" complexity ratings) and the two most exposed to genuine external unknowns (Meta's review process, OpenAI's real-world conversational behavior) that no amount of upfront documentation can fully de-risk in advance.
- This timeline explicitly **excludes** any post-launch roadmap work (PROJECT_REQUIREMENTS.md Section 11's Future Features) — it covers Milestones 1–10 only, ending at Section 4 Sprint 10.2's go-live, not an ongoing maintenance/growth timeline.

---

## 12. Coding Standards

These standards operationalize decisions already made in the prior six documents — this section is a **consolidated reference**, not a new design surface; where a rule below duplicates something PRISMA_SCHEMA.md/SYSTEM_ARCHITECTURE.md/FRONTEND_ARCHITECTURE.md already specified, the citation is given rather than the rule being re-derived.

### 12.1 Folder Organization

Backend follows SYSTEM_ARCHITECTURE.md Section 14's structure exactly (`core/`, `common/`, `modules/<domain>/{domain,application,infrastructure,interface}`, `queues/`, `config/`); frontend follows FRONTEND_ARCHITECTURE.md Section 2 exactly (`core/`, `shared/{components/primitives,components/domain,directives,pipes,validators,models}`, `layouts/`, `features/<domain>/{pages,components,services,state,models}`). No module in either codebase deviates from its documented folder shape without a corresponding architecture-document update (Section 8.1) — folder structure is part of the contract, not an implementation detail left to individual taste.

### 12.2 Naming Conventions

Backend: PRISMA_SCHEMA.md Section 1.10's table/model naming rules extend directly to NestJS — `PascalCase` classes (`AppointmentsService`, `CreateAppointmentDto`), `camelCase` methods/variables, `kebab-case` file names (`appointments.service.ts`, `create-appointment.dto.ts`), module folder names matching their domain exactly as listed in Section 5. Frontend: FRONTEND_ARCHITECTURE.md's implicit Angular conventions made explicit — `kebab-case` selectors and file names (`app-appointment-card`, `appointment-card.component.ts`), `PascalCase` classes, signal-holding properties named for the value they hold, not suffixed `$` (that suffix is reserved, by convention, for `Observable`s specifically — SYSTEM_ARCHITECTURE.md/FRONTEND_ARCHITECTURE.md Section 1.3's signals/RxJS distinction made visually obvious in code).

### 12.3 TypeScript Rules

- `strict: true` in both `tsconfig.json`s, no exceptions — `strictNullChecks`, `noImplicitAny`, `strictPropertyInitialization` all on.
- `any` is **prohibited** outside a narrowly-scoped, commented exception (e.g., a genuinely-untyped third-party payload at a system boundary, immediately cast to a proper type on the next line) — `unknown` plus a type guard is the default for anything genuinely unknown.
- Every API_SPECIFICATION.md DTO has a corresponding TypeScript interface/type on **both** sides of the stack (backend DTO class, frontend `shared/models` interface) — kept in sync manually at this project's scope (FRONTEND_ARCHITECTURE.md Section 2.2 already flagged codegen as a future improvement, not adopted at MVP scope per this roadmap).
- No `// @ts-ignore` merged without a linked follow-up task explaining why the suppression is temporary.

### 12.4 Angular Conventions

Standalone components exclusively (no `NgModule`-based components, consistent with FRONTEND_ARCHITECTURE.md Section 4.5's note on Angular 20's standalone model); `input()`/`output()` signal-based APIs, never legacy `@Input()`/`@Output()` decorators (FRONTEND_ARCHITECTURE.md Section 7); `OnPush` change detection on every component without exception (FRONTEND_ARCHITECTURE.md Section 14.5); Reactive Forms exclusively, never Template-Driven (FRONTEND_ARCHITECTURE.md Section 8.1); smart/dumb component boundary enforced per FRONTEND_ARCHITECTURE.md Section 1.4 — a `shared/components/*` file importing `HttpClient` or any store fails review automatically.

### 12.5 NestJS Conventions

Clean Architecture layering within every module exactly as SYSTEM_ARCHITECTURE.md Section 2.1 specified (`domain/application/infrastructure/interface`); constructor-based dependency injection exclusively (never property injection, never manual instantiation of an injectable class); every module's public surface is its `application` layer's exported service — no cross-module reach into another module's `infrastructure`/`domain` internals (SYSTEM_ARCHITECTURE.md Section 2.3's module-boundary rule, enforced by NestJS's own module-export mechanism combined with code review); global `ValidationPipe` applied at bootstrap (SYSTEM_ARCHITECTURE.md Section 9.3), never a per-controller opt-in.

### 12.6 Prisma Conventions

Exactly PRISMA_SCHEMA.md's conventions (Sections 1, 11) — no direct `PrismaClient` usage outside a module's `infrastructure` layer repository classes; every tenant-scoped repository method requires a `tenantId` parameter as a matter of the base-repository contract (Section 4, Sprint 3.1's foundational pattern) — a repository method signature that *could* query a tenant-owned table without one is treated as a Section 13 quality-gate failure, not a style nitpick; every migration reviewed against PRISMA_SCHEMA.md Section 14.4's documented manual-edit requirements before being applied.

### 12.7 Logging Standards

Structured JSON logs exclusively (SYSTEM_ARCHITECTURE.md Section 10.9), every log line tagged with `requestId` (API_SPECIFICATION.md Section 2.9), `tenantId` where applicable, and correlation to the originating module. Log levels used consistently: `error` (an actual failure requiring attention), `warn` (a handled-but-notable condition, e.g., a guardrail rejection), `info` (a significant business event — appointment created, subscription changed), `debug` (verbose, disabled in production by default). **Never** logged: raw passwords, raw tokens, full credit-card-adjacent data (never present in this system per Stripe's hosted-checkout model), unredacted customer PII beyond what's operationally necessary (FRONTEND_ARCHITECTURE.md Section 17.5's redaction principle applies identically to backend logs).

### 12.8 Error Handling

A single global exception filter (SYSTEM_ARCHITECTURE.md Section 3.2's `Core` module) normalizes every thrown exception into API_SPECIFICATION.md Section 2.3's error envelope — no controller manually constructs an error response. Business-rule failures throw typed, named exception classes (`SlotNoLongerAvailableException`, `TenantSuspendedException`) mapped to their documented HTTP status/error code by the global filter, never a generic `throw new Error(...)` for anything the API contract has already named.

### 12.9 Validation

`class-validator`/`class-transformer` decorators on every DTO, mirroring API_SPECIFICATION.md's per-endpoint "Validation Rules" exactly — the DTO *is* the validation rule's implementation, not a separate, potentially-drifting hand-written check. JSONB-typed fields (`AIContext.state`, `AuditLog.metadata`) are validated against an explicit schema (a Zod schema or equivalent) at the point of write, per DATABASE_DESIGN.md Risk DB-R4's explicit warning against unvalidated JSONB growth.

### 12.10 Dependency Injection

Constructor injection only, on both stacks where applicable (NestJS's DI container backend-side; Angular's `inject()` function or constructor injection frontend-side, never a service-locator pattern). Every injectable service backend-side is designed against an interface/port where it wraps an external dependency (SYSTEM_ARCHITECTURE.md Section 2.1's Clean Architecture ports pattern) specifically so it can be substituted with a test double in integration tests without touching real OpenAI/WhatsApp/Stripe APIs on every test run.

### 12.11 Configuration Management

Every environment variable is declared and validated at bootstrap (fail-fast, SYSTEM_ARCHITECTURE.md Section 10.6) — no `process.env.X` access scattered through business logic; a single typed `ConfigService` (backend) / `environment.ts` (frontend, build-time only, never runtime secrets) is the sole access point. `.env.example` is kept current as a Section 9 Definition-of-Done requirement, documenting every required variable without real values.

---

## 13. Quality Gates

**No PR merges to `main` unless every gate below passes in CI** (SYSTEM_ARCHITECTURE.md Section 10.5's pipeline, Section 2.3 of this document) — these are automated where possible, and explicitly called out as manual where automation isn't practical at this project's scale, rather than silently skipped.

| Gate | Mechanism | Blocking? |
|---|---|---|
| **Linting** | ESLint (backend + frontend), automated in CI | Yes — any lint error blocks merge |
| **Formatting** | Prettier, automated, run as a pre-commit hook **and** a CI check (catches the case where a hook was bypassed) | Yes |
| **Unit tests** | `npm test` (backend + frontend), automated in CI | Yes — any failing or newly-uncovered-by-zero-tests business logic blocks merge |
| **Integration tests** | Run against an ephemeral, CI-provisioned Postgres/Redis (mirroring production topology, SYSTEM_ARCHITECTURE.md Section 10.2), automated in CI | Yes — **including the standing regression suites** (tenant-isolation, booking-conflict, AI-guardrail, Section 10's IR-6/IR-7/IR-10) on every relevant PR, not just the milestone that introduced them |
| **Security review** | Automated dependency-vulnerability scan (every PR) **plus** a manual checklist pass (Section 9's Security checklist) for any PR touching auth, tenant-scoping, webhook handling, or payment logic | Automated portion: yes. Manual portion: required only for the flagged sensitive-change categories, explicitly named so it's never ambiguous whether a PR needs it |
| **Performance review** | Bundle-size budget check (frontend, automated, FRONTEND_ARCHITECTURE.md Section 14.7); a manual query-plan review for any new query against a high-volume table (`Appointment`, `Message`, `AuditLog`, DATABASE_DESIGN.md Section 12) | Automated portion: yes. Manual portion: required only for the flagged high-volume-table category |
| **Documentation review** | Manual check (part of the PR template, Section 2.5) confirming Section 8.1's living-document policy was honored | Yes — an unaddressed documentation-impact checkbox blocks merge, exactly as a failing test would |

---

## 14. AI Collaboration Rules

Rules for every future development session — human-initiated or autonomous — working against this roadmap. These formalize, as binding process, the same discipline this document itself was produced under across its six predecessors.

1. **Work from this document's current milestone and sprint.** Before writing any code, identify which Section 4 sprint the requested work belongs to; if it doesn't clearly belong to the current sprint, flag the mismatch rather than silently proceeding — either the roadmap needs updating or the request is premature/out of sequence.
2. **Implement one sprint task at a time.** A single session's scope is one task from one sprint's task list (Section 4), never "let's also knock out the next sprint while we're at it" — Section 1.4's incremental-delivery discipline applies to individual sessions, not just milestones.
3. **Never modify files unrelated to the current task.** A PR/session touching `appointments` should not incidentally reformat, refactor, or "improve" unrelated files in `billing` — unrelated cleanup is its own, separately-tracked task (Section 2.5).
4. **Always update the relevant source-of-truth document in the same session**, per Section 8.1 — a schema change without a PRISMA_SCHEMA.md update, or an API change without an API_SPECIFICATION.md update, is an incomplete session, not a follow-up item.
5. **Explain the architectural decision before writing the implementation**, whenever a task involves a genuine choice not already fully specified by the six prior documents — a one-paragraph rationale before code, matching the "why," not just "what," standard every document in this series has been held to.
6. **Keep changes small and reviewable.** If a task's implementation is growing past what one focused PR can reasonably hold, stop and split it — this is a signal the task itself was under-scoped in Section 4, worth flagging back into the roadmap, not a reason to ship one enormous, unreviewable change.
7. **Ask for explicit approval before any schema change** (a new Prisma model, a new column, a changed relation or constraint) — schema changes are the hardest category of change to walk back once real data exists (PRISMA_SCHEMA.md Section 11.5's backward-compatible-migration discipline), and this project's entire documentation-first approach exists specifically to make schema changes deliberate, not incidental.
8. **Generate tests with every feature, not after it, and not only on request** — Section 9's Definition of Done is not optional scope, it is the definition of the feature being finished at all; a session that produces code without corresponding tests has produced an unfinished task, regardless of whether the code appears to work.
9. **Refactor instead of duplicating code** — if a new task needs logic that closely resembles something already built (a validator, a query pattern, a component), extend or reuse it (FRONTEND_ARCHITECTURE.md Section 1.6, Section 12 of this document) rather than copy-pasting a near-duplicate; where reuse would require a larger refactor than the current task justifies, flag it as a follow-up task rather than silently duplicating.
10. **Treat the standing regression suites as inviolable.** Any change that would require weakening, skipping, or deleting a test in the tenant-isolation, booking-conflict-prevention, or AI-guardrail suites (Sections 4 and 10) is a stop-and-escalate situation, never a change to make unilaterally — these three suites exist specifically to catch the platform's three highest-consequence failure modes, and a task that seems to require breaking one of them almost always means the task's *design*, not the test, is wrong.
11. **Respect the milestone boundary between MVP and Future Features** (Section 1.5) — a session is never the right place to make an independent judgment call to "go ahead and add" a PROJECT_REQUIREMENTS.md Section 11 future feature or activate a future-ready schema hook (`Branch`/`Room`) ahead of schedule, no matter how small it seems in the moment.
12. **When genuinely blocked or facing an ambiguous product decision** (not an architectural one already covered by rule 5, but a real "what should this actually do" product question), surface the question rather than guessing and proceeding — this roadmap's sprints specify *what* and *why* in detail precisely so guessing should rarely be necessary, and a genuine gap is worth surfacing, not papering over.

---

## Document Status & Next Steps

This document defines the **implementation roadmap and process only** — no application code has been produced, per instruction.

**Key decisions made in this phase requiring explicit sign-off before implementation begins:**
1. Ten milestones, 18 sprints, in the dependency order justified in Section 1.1 — Foundation → Auth → Multi-Tenancy → Salon Management → Scheduling → WhatsApp → AI → Billing → Analytics/Notifications/Admin → Production.
2. Three **standing regression suites** (tenant isolation, booking-conflict prevention, AI guardrails) established early and treated as inviolable for the rest of the project (Sections 4, 10, 13, 14) — the concrete mechanism by which this roadmap protects its three highest-consequence risks throughout every later milestone, not just when they're first built.
3. A living-document policy making PRISMA_SCHEMA.md/API_SPECIFICATION.md/FRONTEND_ARCHITECTURE.md updates a hard, PR-blocking requirement (Section 8.1/13), not a best-effort intention.
4. A review process explicitly adapted for a solo-developer-plus-AI-assistance context (Section 2.6), with a defined upgrade path if a second person joins.
5. An 18-sprint / ~5-month expected timeline (Section 11), with Milestones 6 and 7 carrying the widest uncertainty range due to genuine external dependencies (Meta verification, OpenAI behavior) no amount of upfront planning fully eliminates.
6. Three known gaps from prior documents (`POST /files`, `ServiceCategory` CRUD, invitation acceptance) are explicitly scheduled for closure in Sprints 4.1 and 2.2 respectively, rather than left open indefinitely.

**This is the final planning document in the series.** With this document approved, the project moves from **planning into implementation** — the next work session should begin at Milestone 1, Sprint 1.1.

**Awaiting your approval before implementation begins.**

