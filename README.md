# Kapis Receptionist

AI-powered WhatsApp appointment booking SaaS for salons and beauty businesses — a multi-tenant platform where an AI receptionist answers customer questions, books/reschedules/cancels appointments, and hands off to staff when needed, all inside WhatsApp.

**Status:** In development — Milestone 1 (Project Foundation) complete; Milestone 2 (Authentication) complete — Core Authentication (Register/Login/Logout/Refresh/Get Current User) and Sprint 2.3 Account Security (email verification + resend, password reset, login-attempt tracking/lockout), both stacks, done; Milestone 3 (Multi-Tenant SaaS Engine) complete — tenant profile/settings/invitations, RBAC enforcement, the tenant-context resolution mechanism, Platform Admin impersonation, and a platform-wide audit trail, both stacks, done; Milestone 4 (Salon Management) complete — salon business profile, branding, business hours, and holiday management, both stacks, done — see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/TENANT_ARCHITECTURE.md](docs/TENANT_ARCHITECTURE.md), [docs/SALON_ARCHITECTURE.md](docs/SALON_ARCHITECTURE.md), and [docs/adr/](docs/adr/) for the full decision record of each milestone. See [IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) for the full (now eleven-milestone) plan.

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
