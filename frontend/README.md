# Frontend

Angular 20 frontend for the Kapis Receptionist AI WhatsApp appointment booking platform.

See the repository root [README.md](../README.md) and [docs/](../docs/) — in particular [FRONTEND_ARCHITECTURE.md](../docs/FRONTEND_ARCHITECTURE.md) for the folder structure, routing, state management, and API layer conventions this project follows.

## Structure

```
src/
├── app/
│   ├── core/           Singleton services (api, auth, config, error, guards, interceptors, logging)
│   ├── shared/          Reused across ≥2 features (components, directives, pipes, validators, models, utils)
│   ├── layouts/          Shell composition — chrome only, no business logic
│   ├── features/        Feature-first vertical slices, lazy-loaded — only `dashboard-home` (placeholder) exists so far
│   ├── app.routes.ts
│   └── app.config.ts
├── environments/         environment.ts / environment.staging.ts / environment.prod.ts
└── styles/               Tailwind entry point (design tokens land here once approved)
```

This project is under active foundational setup (Milestone 1 of [IMPLEMENTATION_ROADMAP.md](../docs/IMPLEMENTATION_ROADMAP.md)) — most `core`/`shared`/`layouts` subfolders are intentionally empty placeholders, and `features/` contains only a placeholder landing page proving the stack end to end.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run the dev server (`http://localhost:4200`) |
| `npm run build` | Production build to `dist/frontend` |
| `npm run watch` | Development build in watch mode |
| `npm test` | Run unit tests (Karma/Jasmine) |
| `npm run lint` | Lint with `angular-eslint` |

## Environment

`environment.ts` (development) points at `http://localhost:3000/api/v1`. `environment.prod.ts` uses the relative `/api/v1` path, since Nginx reverse-proxies API traffic to the backend on the same origin in production (SYSTEM_ARCHITECTURE.md Section 10.3).
