# Production Deployment Guide

Step-by-step deployment of Kapis Receptionist to a fresh Ubuntu server. Read `docs/PRODUCTION_CHECKLIST.md` first — this guide operationalizes its P0/P1 items and assumes you've already obtained the accounts/credentials it lists (OpenAI, Meta/WhatsApp, Stripe live keys, SMTP provider, domain, server).

**Important — read before starting:** the repository currently ships `infrastructure/docker-compose.yml` for **local development only** (runs the Angular dev server, bind-mounts source, no TLS). There is no `docker-compose.prod.yml` in the repo yet. This guide includes a reference production compose file and Nginx config for you to create — they are not pre-built for you, per `docs/PRODUCTION_CHECKLIST.md` §4/§7 (P0 #2).

Target: Ubuntu 22.04 LTS or 24.04 LTS, a single VPS (e.g. Hetzner). Adjust for a multi-host setup if you outgrow one box.

---

## 1. Server Preparation

```bash
# SSH in as root (or a sudo user) on the fresh server
ssh root@<server-ip>

# Create a non-root deploy user
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Basic hardening
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Disable password SSH auth (key-only) once you've confirmed key login works
# Edit /etc/ssh/sshd_config: PasswordAuthentication no
systemctl restart sshd
```

Switch to the `deploy` user for everything below unless noted otherwise.

---

## 2. Docker Installation

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # or log out/in

docker --version
docker compose version
```

---

## 3. Node.js Installation (host-level — only needed for running Prisma CLI commands directly on the host; the app itself runs in containers)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirm v20.x, matching backend/.nvmrc
```

---

## 4. Clone the Repository

```bash
sudo mkdir -p /opt/kapis-receptionist
sudo chown deploy:deploy /opt/kapis-receptionist
git clone <your-repo-url> /opt/kapis-receptionist
cd /opt/kapis-receptionist
git checkout main   # or your release tag/branch
```

---

## 5. Environment Variables

```bash
cp backend/.env.example backend/.env
```

Fill in every variable from `docs/PRODUCTION_CHECKLIST.md` §1 and §3 with **freshly generated production values**:

```bash
# JWT secrets — independent, never reused
openssl rand -base64 48   # -> JWT_ACCESS_SECRET
openssl rand -base64 48   # -> JWT_REFRESH_SECRET

# WhatsApp token encryption key — must decode to exactly 32 bytes
openssl rand -base64 32   # -> WHATSAPP_TOKEN_ENCRYPTION_KEY

# AI internal API key
openssl rand -base64 32   # -> AI_INTERNAL_API_KEY

# Postgres/Redis passwords
openssl rand -base64 24   # -> POSTGRES_PASSWORD (infrastructure/env/.env)
openssl rand -base64 24   # -> Redis requirepass, if enabling Redis auth
```

Set explicitly (do not leave at `.env.example` defaults):
- `NODE_ENV=production` — **critical**: the refresh-token cookie's `Secure` flag depends on this.
- `CORS_ORIGIN=https://app.yourdomain.com`
- `FRONTEND_URL=https://app.yourdomain.com`
- `MAIL_FROM=no-reply@yourdomain.com` (domain-verified with your SMTP provider)
- `BILLING_CHECKOUT_SUCCESS_URL` / `BILLING_CHECKOUT_CANCEL_URL` / `BILLING_PORTAL_RETURN_URL` — real HTTPS URLs on your domain
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — **live** mode keys, not test
- `DATABASE_URL` / `REDIS_URL` — pointed at the containers created in the next steps

Lock down the file:
```bash
chmod 600 backend/.env
```

Never commit `backend/.env` — confirm it stays gitignored (it already is).

---

## 6. Postgres & Redis

Run as containers via the production compose file (§8), not manually installed on the host — keeps versions pinned and matches how CI/dev already run them. If you prefer host-installed Postgres/Redis instead (e.g. for a managed-DB migration path later), the compose file's `postgres`/`redis` services can be omitted and `DATABASE_URL`/`REDIS_URL` pointed at your managed instances — the app doesn't care which.

If self-hosting via Docker (this guide's default), enable Redis auth:
```yaml
# in the redis service command, in docker-compose.prod.yml:
command: redis-server --requirepass "${REDIS_PASSWORD}"
```
and reflect the password in `REDIS_URL=redis://:REDIS_PASSWORD@redis:6379`.

---

## 7. Nginx + SSL (Let's Encrypt / Certbot)

Install Nginx and Certbot on the **host** (not containerized), so it can bind port 80/443 and manage certs directly — simpler renewal story than a containerized Certbot for a single-server deploy.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Point your domain's DNS `A`/`AAAA` record at the server IP before continuing (via Cloudflare or your registrar).

Create `/etc/nginx/sites-available/kapis-receptionist`:

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4200;   # static frontend build, served by its own container/nginx — see §8
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # WhatsApp/Stripe webhooks — same backend, no auth prefix
    location /webhooks/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kapis-receptionist /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Issue the certificate — certbot edits the server block to add the 443
# listener, HTTPS redirect, and HSTS automatically with --redirect
sudo certbot --nginx -d app.yourdomain.com --redirect --hsts

# Confirm auto-renewal is scheduled (certbot installs this by default)
sudo systemctl status certbot.timer
```

Add security headers Helmet doesn't cover at the app layer (defense-in-depth; the app should also add Helmet server-side per `docs/PRODUCTION_CHECKLIST.md` P0 #3 — do both, don't rely on Nginx alone):

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.yourdomain.com;" always;
```

Adjust the CSP to match your actual frontend's asset/API origins before enabling — an overly strict CSP will silently break the app.

---

## 8. Production Docker Compose

Create `infrastructure/docker-compose.prod.yml` (does not exist in the repo yet — this is the reference to build):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass "${REDIS_PASSWORD}"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ../backend
      target: production
    restart: unless-stopped
    env_file: ../backend/.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: ../frontend
      target: production   # static build served by a slim nginx/http server, NOT `ng serve`
    restart: unless-stopped
    ports:
      - "127.0.0.1:4200:80"

volumes:
  postgres_data:
  redis_data:
```

This differs from the dev `docker-compose.yml` in three load-bearing ways: no source bind-mounts, `frontend` builds a static production bundle instead of running the Angular dev server, and `backend`/`frontend` ports are bound to `127.0.0.1` only — the host's Nginx (from §7) is the sole public entry point, containers are never directly internet-reachable. Confirm `frontend/Dockerfile` has a `production` build stage (serving the compiled `dist/` via a minimal static server, e.g. nginx or `http-server`) — if it doesn't exist yet, add one before using this compose file; the current repo's frontend Dockerfile is dev-oriented (check before relying on this).

`infrastructure/env/.env` (compose-level, separate from `backend/.env`):
```
POSTGRES_USER=kapis
POSTGRES_PASSWORD=<generated above>
POSTGRES_DB=kapis_receptionist
REDIS_PASSWORD=<generated above>
```

---

## 9. Build

```bash
cd /opt/kapis-receptionist/infrastructure
docker compose -f docker-compose.prod.yml --env-file env/.env build
```

---

## 10. Database Migration

Run migrations **before** starting the app, against the production database:

```bash
docker compose -f docker-compose.prod.yml --env-file env/.env up -d postgres redis
# wait for postgres healthcheck to pass
docker compose -f docker-compose.prod.yml --env-file env/.env run --rm backend npx prisma migrate deploy
```

`prisma migrate deploy` (not `migrate dev`) — applies committed migrations non-interactively, never generates new ones. This mirrors what CI already does against its ephemeral test database (`.github/workflows/ci.yml`).

---

## 11. Seed Reference Data

**Required in every environment, including production** — Roles, Permissions, Plans:

```bash
docker compose -f docker-compose.prod.yml --env-file env/.env run --rm backend npm run prisma:seed
```

Before relying on billing, replace the placeholder Stripe Price IDs this seed creates (`price_placeholder_*`) with real live-mode Price IDs from your Stripe Dashboard — either re-run the seed after editing `prisma/seed.ts`'s `PLANS` array, or `PATCH /admin/plans/:id` per plan once the app is running.

**Do not run `npm run demo:seed` against production** — it creates a fictional demo tenant/salon (`aurora-beauty-lounge-demo`) intended for sales demos and local development only, not production data.

---

## 12. Start

```bash
docker compose -f docker-compose.prod.yml --env-file env/.env up -d
docker compose -f docker-compose.prod.yml ps   # confirm all services show healthy
```

---

## 13. Health Verification

```bash
curl -f https://app.yourdomain.com/health
curl -f https://app.yourdomain.com/health/ready
```

Expect `{"status":"ok"}` from the first and `{"status":"ok","database":"connected","redis":"connected"}` from the second. If `/health/ready` returns 503, check `docker compose logs backend` — most commonly a `DATABASE_URL`/`REDIS_URL` mismatch or a migration that hasn't been applied yet.

Manually verify:
- Register a real account through the production frontend, confirm the verification email actually arrives (real SMTP, unlike local dev's log-only fallback).
- Complete a Stripe Checkout in live mode with a real card (or Stripe's live-mode test flow if available) to confirm the webhook round-trip works end-to-end.
- Send a WhatsApp message to the connected number and confirm the AI receptionist replies, to confirm the webhook signature verification and Graph API credentials are correct in production.

Set up external uptime monitoring pointed at `/health/ready` (see `docs/PRODUCTION_CHECKLIST.md` §2) — a container reporting "healthy" to Docker isn't the same as external confirmation the site is actually reachable.

---

## 14. Rollback

Because migrations are forward-only (`prisma migrate deploy` never auto-generates a down-migration), rollback strategy is:

1. **App code rollback** (no schema change involved): re-deploy the previous image/git tag.
   ```bash
   git checkout <previous-release-tag>
   docker compose -f docker-compose.prod.yml --env-file env/.env build backend frontend
   docker compose -f docker-compose.prod.yml --env-file env/.env up -d backend frontend
   ```
2. **Schema-change rollback**: write and commit an explicit down-migration (a new forward migration that reverses the change) rather than attempting to un-apply the bad one — this is the standard, safe Prisma pattern. Never manually edit already-applied migration files or hand-edit `_prisma_migrations` in production.
3. If a bad migration already corrupted data, restore from the most recent backup (§15) instead of trying to migrate your way out — safer once data integrity is in question.

Rehearse this at least once against a staging environment before you need it for real (`docs/PRODUCTION_CHECKLIST.md` P1 #16).

---

## 15. Backup

```bash
# Manual backup
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Ship it off-host immediately — a backup that lives only on the server
# you're protecting against is not a backup
aws s3 cp backup_*.sql.gz s3://your-backup-bucket/postgres/   # or any S3-compatible provider
```

Automate via cron (`crontab -e` as the `deploy` user):
```cron
0 3 * * * cd /opt/kapis-receptionist && ./scripts/db/backup.sh >> /var/log/kapis-backup.log 2>&1
```

`scripts/db/` exists in the repo but is currently empty — write `backup.sh` wrapping the `pg_dump`+upload commands above before relying on this cron entry. Retain at minimum: daily backups for 7 days, weekly for 4 weeks, monthly for 6 months — adjust to your compliance requirements.

---

## 16. Restore

```bash
# Download the backup
aws s3 cp s3://your-backup-bucket/postgres/backup_20260101_030000.sql.gz .
gunzip backup_20260101_030000.sql.gz

# Stop the backend so nothing writes during restore
docker compose -f docker-compose.prod.yml stop backend

# Restore into a FRESH database, verify it, then swap — never restore
# directly over a live database you might still need
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U ${POSTGRES_USER} -c "CREATE DATABASE kapis_receptionist_restore;"
cat backup_20260101_030000.sql | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U ${POSTGRES_USER} -d kapis_receptionist_restore

# Spot-check row counts / recent rows against expectations, then:
# either point DATABASE_URL at kapis_receptionist_restore and restart backend,
# or rename databases to swap the restored copy into the primary name.

docker compose -f docker-compose.prod.yml start backend
curl -f https://app.yourdomain.com/health/ready
```

**Test this restore procedure on a schedule (e.g. quarterly) against a non-production environment** — an untested backup is not a disaster recovery plan, it's a hope.

---

## Summary Checklist

- [ ] Server hardened (UFW, fail2ban, key-only SSH)
- [ ] Docker + Compose installed
- [ ] Repo cloned, correct branch/tag checked out
- [ ] `backend/.env` populated with fresh production secrets, `chmod 600`
- [ ] `NODE_ENV=production` confirmed set
- [ ] DNS pointed at the server
- [ ] `docker-compose.prod.yml` created (static frontend build, no bind mounts, containers bound to localhost only)
- [ ] Nginx + Certbot TLS issued, HTTPS redirect + HSTS enabled
- [ ] Security headers / CSP added at Nginx and Helmet added at the app layer
- [ ] Images built
- [ ] `prisma migrate deploy` run against production DB
- [ ] `npm run prisma:seed` run (Roles/Permissions/Plans), placeholder Stripe Price IDs replaced with live ones
- [ ] Stack started, all containers healthy
- [ ] `/health` and `/health/ready` verified externally
- [ ] End-to-end smoke test: register + verify email, Stripe checkout, WhatsApp message round-trip
- [ ] Uptime monitoring configured against `/health/ready`
- [ ] Error tracking (Sentry or equivalent) receiving events
- [ ] Automated backups scheduled and running
- [ ] Restore procedure tested at least once
- [ ] Rollback procedure rehearsed at least once
