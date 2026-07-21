#!/usr/bin/env bash
# One-shot local environment setup (IMPLEMENTATION_ROADMAP.md Sprint 1.1 deliverable).
# Mirrors the README.md "Getting Started" steps — see that file if any step
# here needs explaining. Safe to re-run.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "==> Installing root dev tooling (git hooks)"
npm install

echo "==> Configuring backend environment"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "    Created backend/.env from backend/.env.example"
else
  echo "    backend/.env already exists, leaving it as-is"
fi

echo "==> Building and starting the stack"
cd infrastructure
docker compose up -d --build

echo "==> Waiting for backend to become healthy"
for i in $(seq 1 30); do
  status="$(docker compose ps --format json backend | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Health",""))' 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 2
done

echo "==> Applying migrations and seeding reference data"
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma db seed

echo
echo "Done. Services:"
docker compose ps
echo
echo "  App (via nginx):  http://localhost:8080"
echo "  Swagger:          http://localhost:3000/api/docs"
echo "  Health:           http://localhost:3000/health/ready"
