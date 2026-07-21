# Backend

NestJS backend for the Kapis Receptionist AI WhatsApp appointment booking platform.

See the repository root [README.md](../README.md) and [docs/](../docs/) for full architecture documentation — in particular [SYSTEM_ARCHITECTURE.md](../docs/SYSTEM_ARCHITECTURE.md) Section 3 (backend module design) and Section 14 (folder structure this project follows).

## Structure

```
src/
├── core/        Cross-cutting infrastructure (tenant context, guards, interceptors) — not yet populated
├── common/      Shared DTOs/utilities with no business logic — not yet populated
├── modules/     Domain modules (Auth, Tenants, Appointments, ...) — not yet populated
├── queues/      Background job definitions/processors — not yet populated
├── config/      Environment configuration — not yet populated
├── prisma/      Prisma client wrapper service — not yet populated
├── app.module.ts
└── main.ts
prisma/
└── schema.prisma   Prisma schema and migrations — not yet populated
test/
├── unit/         Fast, isolated unit tests
├── integration/  Tests against a real ephemeral database/Redis
└── e2e/          Full HTTP-request tests against a running app instance
```

This project is under active foundational setup (Milestone 1 of [IMPLEMENTATION_ROADMAP.md](../docs/IMPLEMENTATION_ROADMAP.md)) — most directories above are intentionally empty placeholders at this stage.

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Run the app in watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | Lint and auto-fix |
| `npm run format` | Format with Prettier |
| `npm test` | Run unit tests (`test/unit/`) |
| `npm run test:e2e` | Run end-to-end tests (`test/e2e/`) |
