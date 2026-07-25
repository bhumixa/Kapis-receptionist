# Kapis Receptionist

AI-powered WhatsApp appointment booking SaaS for salons and beauty businesses — a multi-tenant platform where an AI receptionist answers customer questions, books/reschedules/cancels appointments, and hands off to staff when needed, all inside WhatsApp.

**Status:** In development — Milestone 1 (Project Foundation) complete; Milestone 2 (Authentication) complete — Core Authentication (Register/Login/Logout/Refresh/Get Current User) and Sprint 2.3 Account Security (email verification + resend, password reset, login-attempt tracking/lockout), both stacks, done; Milestone 3 (Multi-Tenant SaaS Engine) complete — tenant profile/settings/invitations, RBAC enforcement, the tenant-context resolution mechanism, Platform Admin impersonation, and a platform-wide audit trail, both stacks, done; Milestone 4 (Salon Management) complete — salon business profile, branding, business hours, and holiday management, both stacks, done; Milestone 5 (Workforce & Service Catalog) complete — employee profile/status/working-hours/time-off, the service catalog (categories, services, duration/pricing/buffer time), and Employee ↔ Service assignment, both stacks, done; Milestone 6 (Appointment & Scheduling Engine) complete — Customer CRUD, the Availability slot-computation engine, and the full Appointment booking lifecycle (create/cancel/reschedule/list) with two-layer Redis-lock-plus-database-constraint conflict prevention, both stacks, done; Milestone 7 (WhatsApp Cloud Platform Integration) complete — WhatsApp Business account connection, signature-verified webhook ingestion via a new BullMQ job queue, Conversation/Message persistence with two-layer idempotency, contact synchronization, manual outbound replies with 24-hour-window enforcement, and a two-pane frontend inbox, both stacks, done; Milestone 8 (AI Receptionist) complete — an OpenAI-backed conversational AI orchestrating the existing Appointments/Availability/Services/Salon/WhatsApp modules as tools (check availability, book/reschedule/cancel, recommend a service, answer FAQs, escalate to a human), server-side guardrails against hallucinated tool arguments, a fallback-and-auto-escalate path for provider outages, human hand-off with take-over controls, and a dashboard "Test my AI" sandbox, both stacks, done; Milestone 9 (Billing & Subscription Management) complete — Stripe-backed Plans/Subscriptions/Invoices/Payments, Checkout and Customer Portal sessions, idempotent signature-verified webhook processing, a centralized `EntitlementService` feature-gate enforcing employee/appointment/AI-message limits across the Employees/Appointments/WhatsApp modules (no module checks plan fields directly), a grace-period trial/past-due/cancellation lifecycle synced automatically from Stripe, and a full billing dashboard plus Platform Admin plan-management and tenant-billing-lookup pages, both stacks, done — see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/TENANT_ARCHITECTURE.md](docs/TENANT_ARCHITECTURE.md), [docs/SALON_ARCHITECTURE.md](docs/SALON_ARCHITECTURE.md), [docs/WORKFORCE_ARCHITECTURE.md](docs/WORKFORCE_ARCHITECTURE.md), [docs/SERVICE_ARCHITECTURE.md](docs/SERVICE_ARCHITECTURE.md), [docs/SCHEDULING_ARCHITECTURE.md](docs/SCHEDULING_ARCHITECTURE.md), [docs/CALENDAR_ENGINE.md](docs/CALENDAR_ENGINE.md), [docs/WHATSAPP_ARCHITECTURE.md](docs/WHATSAPP_ARCHITECTURE.md), [docs/MESSAGING_ARCHITECTURE.md](docs/MESSAGING_ARCHITECTURE.md), [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md), [docs/BILLING_ARCHITECTURE.md](docs/BILLING_ARCHITECTURE.md), and [docs/adr/](docs/adr/) for the full decision record of each milestone. See [IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) for the full (now eleven-milestone) plan.

## Documentation

This project is built documentation-first. Every implementation decision traces back to one of the documents below, kept current as the source of truth throughout development (see IMPLEMENTATION_ROADMAP.md Section 8's living-document policy).

| Document | Purpose |
|---|---|
| [PROJECT_REQUIREMENTS.md](docs/PROJECT_REQUIREMENTS.md) | Business goals, personas, functional/non-functional requirements, MVP scope |
| [SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | High-level architecture, backend module design, AI/WhatsApp/security architecture |
| [DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Entity design, multi-tenant data model, indexing strategy |
| [PRISMA_SCHEMA.md](docs/PRISMA_SCHEMA.md) | Prisma schema design and migration strategy |
| [API_SPECIFICATION.md](docs/API_SPECIFICATION.md) | REST API contract between frontend and backend |
| [FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md) | Angular application architecture, component library, state management |
| [IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) | Milestones, sprints, coding standards, quality gates, AI collaboration rules |
| [TENANT_ARCHITECTURE.md](docs/TENANT_ARCHITECTURE.md) | Multi-tenant SaaS engine as-built reference (Milestone 3) |
| [SALON_ARCHITECTURE.md](docs/SALON_ARCHITECTURE.md) | Salon management as-built reference (Milestone 4) |
| [WORKFORCE_ARCHITECTURE.md](docs/WORKFORCE_ARCHITECTURE.md) | Employees, working hours, and time-off as-built reference (Milestone 5) |
| [SERVICE_ARCHITECTURE.md](docs/SERVICE_ARCHITECTURE.md) | Service catalog as-built reference (Milestone 5) |
| [SCHEDULING_ARCHITECTURE.md](docs/SCHEDULING_ARCHITECTURE.md) | Customers, Availability & Appointments as-built reference (Milestone 6) |
| [CALENDAR_ENGINE.md](docs/CALENDAR_ENGINE.md) | Appointments calendar frontend as-built reference (Milestone 6) |
| [WHATSAPP_ARCHITECTURE.md](docs/WHATSAPP_ARCHITECTURE.md) | WhatsApp Cloud API integration, webhooks, queues, and security as-built reference (Milestone 7) |
| [MESSAGING_ARCHITECTURE.md](docs/MESSAGING_ARCHITECTURE.md) | Conversations, messages, and the frontend inbox as-built reference (Milestone 7) |
| [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) | AI receptionist orchestration, tools, and guardrails as-built reference (Milestone 8) |
| [PROMPT_ENGINEERING.md](docs/PROMPT_ENGINEERING.md) | Prompt templates, versioning, and variable interpolation (Milestone 8) |
| [TOOLS.md](docs/TOOLS.md) | The AI tool contract — one section per tool, its underlying service call, and its guardrails (Milestone 8) |
| [BILLING_ARCHITECTURE.md](docs/BILLING_ARCHITECTURE.md) | Billing & subscriptions as-built reference — data model, module layout, lifecycle policy (Milestone 9) |
| [STRIPE_INTEGRATION.md](docs/STRIPE_INTEGRATION.md) | Stripe Checkout, Customer Portal, and webhook processing as-built reference (Milestone 9) |
| [FEATURE_ENTITLEMENTS.md](docs/FEATURE_ENTITLEMENTS.md) | Centralized plan-limit enforcement (`EntitlementService`) as-built reference (Milestone 9) |
| [DECISIONS.md](docs/DECISIONS.md) | Running log of architecture decisions made during implementation (ADRs) |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/releases/](docs/releases/) | Per-release notes (what shipped, verification results, known limitations) |

More detailed, individual ADRs may also live in [docs/adr/](docs/adr/); operational runbooks (deploy, rollback, incident response, backup/restore) live in [docs/runbooks/](docs/runbooks/), both populated incrementally as the project progresses.

## Technology Stack

- **Frontend:** Angular 20, TypeScript, Tailwind CSS, Angular Signals
- **Backend:** NestJS, Prisma, PostgreSQL, Redis
- **Infrastructure:** Docker, Docker Compose, Nginx, GitHub Actions, Hetzner
- **AI / Messaging / Payments:** OpenAI, WhatsApp Cloud API, Stripe

## Repository Structure

```
backend/            NestJS application
frontend/            Angular application
infrastructure/       Docker Compose, Nginx, environment templates
.github/workflows/    CI/CD pipelines
scripts/              DB backup/restore, deploy, local bootstrap scripts
docs/                  Architecture documentation, ADRs, runbooks
```

## Getting Started

**Prerequisites:** Docker and Docker Compose, Git, Node.js 20 (see `.nvmrc` — needed on the host for git hooks below, even if you run the apps themselves via Docker).

```bash
# 1. Install root dev tooling (git hooks — lint-staged, commitlint) once per clone
npm install

# 2. Configure environment
cp backend/.env.example backend/.env
# Fill in JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (each ≥32 chars, independently
# generated — never reuse one for the other): openssl rand -base64 48
# Also required (fail-fast validated at boot, docs/AI_ARCHITECTURE.md): OPENAI_API_KEY
# (a real key only if you want real AI replies — any string ≥20 chars boots fine, the
# AI receptionist just falls back to its configured "unavailable" message) and
# AI_INTERNAL_API_KEY (openssl rand -base64 32) — plus WHATSAPP_* if you're testing
# that integration (docs/WHATSAPP_ARCHITECTURE.md).

# 3. Start the full stack (postgres, redis, backend, frontend, nginx)
cd infrastructure
docker compose up -d --build

# 4. First run only — apply migrations and seed reference data
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma db seed
```

Then:

| What | URL |
|---|---|
| App (via nginx) | http://localhost:8080 |
| Frontend directly | http://localhost:4200 |
| Backend API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/api/docs |
| Health check | http://localhost:3000/health/ready |

`docker compose ps` should show all five services as `healthy`. Stop with `docker compose stop`; `docker compose down -v` also removes the Postgres/Redis volumes (fresh database on next `up`).

Running a single app outside Docker (e.g. for IDE debugging) still works — `cd backend && npm install && npm run start:dev` / `cd frontend && npm install && npm start` — as long as `backend/.env`'s `DATABASE_URL`/`REDIS_URL` point at reachable instances (the Compose-managed ones are published on `localhost:5432`/`localhost:6379`).

### Git Hooks

`npm install` at the repo root activates Husky (IMPLEMENTATION_ROADMAP.md Section 13's Quality Gates):
- **pre-commit** — runs ESLint (with Prettier) on staged `backend/`/`frontend` files, fixing what it can and blocking the commit if anything remains unfixable.
- **commit-msg** — enforces Conventional Commits (Section 2.4): `<type>(<scope>): <description>`, `type` restricted to `feat`/`fix`/`chore`/`docs`/`refactor`/`test`/`perf`/`ci`.
