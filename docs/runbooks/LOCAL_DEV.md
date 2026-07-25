# Running the App Locally

## Quick start (Postgres/Redis already running via Docker, `backend/.env` already configured)

```bash
cd backend && npm run start:dev
```
```bash
cd frontend && npm start
```

| What | URL |
|---|---|
| Backend API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/api/docs |
| Health check | http://localhost:3000/health/ready |
| Frontend | http://localhost:4200 |

Check Postgres/Redis containers are up: `docker ps` (look for `infrastructure-postgres-1`, `infrastructure-redis-1`, both `healthy`).

## Full setup (fresh clone)

```bash
# 1. Root dev tooling (git hooks — lint-staged, commitlint)
npm install

# 2. Configure environment
cp backend/.env.example backend/.env
# Fill in JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (each >=32 chars, independently
# generated): openssl rand -base64 48
# Also required: OPENAI_API_KEY (real key for real AI replies; any string >=20 chars
# boots fine, AI receptionist falls back to its "unavailable" message) and
# AI_INTERNAL_API_KEY (openssl rand -base64 32). Add WHATSAPP_* if testing that
# integration.

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

## Running a single app outside Docker

Works as long as `backend/.env`'s `DATABASE_URL`/`REDIS_URL` point at reachable instances (Compose-managed ones are published on `localhost:5432`/`localhost:6379`):

```bash
cd backend && npm install && npm run start:dev
cd frontend && npm install && npm start
```
