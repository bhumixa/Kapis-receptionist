# SALON_ARCHITECTURE.md

## Salon Management — Implementation Reference

**Document Status:** As-Built
**Milestone:** 4 — Salon Management
**Depends on:** SYSTEM_ARCHITECTURE.md §2.3–2.4, DATABASE_DESIGN.md, PRISMA_SCHEMA.md §4/§14.4, API_SPECIFICATION.md, docs/TENANT_ARCHITECTURE.md, docs/adr/ADR-006-multi-tenant-saas-engine.md, docs/adr/ADR-007-salon-management.md
**Scope:** What Milestone 4 actually built — the salon business profile (contact info, branding, currency), business hours, and holiday management. Employees, Services, Customers, Scheduling, WhatsApp, AI, Billing, and Analytics are explicitly out of scope for this milestone — see docs/adr/ADR-007 and the re-scoped docs/IMPLEMENTATION_ROADMAP.md.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Salon profile read/update (composed with Tenant identity) | `GET/PATCH /salon` | `modules/salon` |
| Weekly business hours | `GET/PUT /salon/business-hours` | `modules/salon` |
| Holiday management (full CRUD) | `GET/POST/PATCH/DELETE /salon/holidays[/:id]` | `modules/salon` |
| Salon dashboard/profile/business-hours/holidays UI | `/app/salon`, `/app/salon/business-hours`, `/app/salon/holidays` | `frontend/features/salon` |

Not built (deliberately, this milestone): Employees, Services, Customers, `Files`/S3 upload (logo is a placeholder URL field only), Scheduling, WhatsApp, AI, Billing, Analytics. All flagged in ADR-007, not silent gaps — the next milestone (renumbered Milestone 5) picks up Employees/Services/Customers/Files.

---

## 2. Data Model

### 2.1 `Tenant` (unchanged this milestone)

Already existed (Milestone 3). `name`, `timezone`, `defaultLocale`, `addressLine1/2`, `city`, `countryCode` continue to be owned and validated by `modules/tenants`, reached exclusively through its exported `TenantService` — never duplicated onto a new table. See §3 for why.

### 2.2 `SalonProfile` — 1:1 satellite table, mirrors `TenantSettings`' precedent

```prisma
model SalonProfile {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String   @unique @db.Uuid
  description    String?  @db.VarChar(1000)
  contactEmail   String?  @db.VarChar(255)
  contactPhone   String?  @db.VarChar(20)
  website        String?  @db.VarChar(255)
  currency       String   @default("USD") @db.Char(3)
  logoUrl        String?  @db.VarChar(500)
  primaryColor   String?  @db.VarChar(7)
  secondaryColor String?  @db.VarChar(7)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Holds only the genuinely new business-facing fields this milestone introduces — never a copy of `Tenant`'s own columns. `logoUrl` is a bare placeholder string (no S3/Files module exists yet); it deliberately does **not** reuse `PRISMA_SCHEMA.md`'s reserved `Tenant.logoFileId` name/shape, so the eventual real Files-backed field won't collide with this placeholder later.

### 2.3 `BusinessHours` — tenant-wide weekly template

```prisma
model BusinessHours {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @db.Uuid
  dayOfWeek Int      @db.SmallInt // 0=Sunday..6=Saturday
  startTime DateTime @db.Time
  endTime   DateTime @db.Time
  isClosed  Boolean  @default(false)
  @@unique([tenantId, dayOfWeek], name: "uq_business_hours_tenant_day")
}
```

Field names/shape match `docs/PRISMA_SCHEMA.md`'s already-reserved, broader Employee/Branch-aware design for this model — this milestone builds exactly the subset that scope supports (no `employeeId`/`branchId` columns, since Employees/Branch don't exist yet). A future milestone only **adds** columns, never renames these.

**Wall-clock storage, not timezone-aware:** `startTime`/`endTime` are `"HH:mm"` strings at the domain/API layer. Prisma maps Postgres `time` (`@db.Time`) to a JS `Date` with an arbitrary `1970-01-01` date part — the first use of that column type in this schema. The mapper (`infrastructure/mappers/prisma-salon.mappers.ts`) reads/writes via **UTC accessors** (`getUTCHours`/`new Date(...Z)`), never local-time accessors, so the stored value never depends on the server process's local timezone. The *interpretation* timezone is `Tenant.timezone`, read separately by whichever future milestone's Availability engine needs it — not stored again here.

**7-day bulk-replace contract:** the DB is NOT NULL on `startTime`/`endTime`, so a closed day still stores a `"00:00"`/`"00:00"` placeholder — clients must key off `isClosed`, never assume null times. `PUT /salon/business-hours` always replaces the full week atomically (one `$transaction` of 7 upserts); a request with fewer/more than 7 entries, duplicate/missing `dayOfWeek` values, or `endTime <= startTime` on a non-closed day is rejected `422 INVALID_BUSINESS_HOURS_SET` (service-layer validation — DTO decorators only validate each day's own shape, not cross-day/cross-field rules).

### 2.4 `Holiday` — tenant-wide only this milestone

```prisma
model Holiday {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @db.Uuid
  date      DateTime @db.Date
  reason    String   @db.VarChar(255)
  @@unique([tenantId, date], name: "uq_holidays_tenant_date")
}
```

No `employeeId`/`branchId` yet (same reasoning as §2.3). `reason` is **required** here, unlike `docs/PRISMA_SCHEMA.md`'s eventual nullable `reason` (which accommodates ad hoc per-employee day-off entries a future milestone adds) — this milestone's salon-wide holiday calendar always needs a display label.

**Forward-compatibility note (partial-unique-index gotcha):** `@@unique([tenantId, date])` is correct and sufficient for this milestone's tenant-wide-only scope. When a future milestone adds `employeeId`, a plain `@@unique([tenantId, date, employeeId])` would **not** prevent two duplicate tenant-wide holidays on the same date, because Postgres treats every `NULL` as distinct in a unique index. That future migration must instead add a manual partial unique index (`CREATE UNIQUE INDEX ... ON holidays(tenant_id, date) WHERE employee_id IS NULL`), per `PRISMA_SCHEMA.md` §14.4's manual-migration-SQL mechanism — not a naive 3-column `@@unique`.

**Deletion is a hard delete** (not soft-delete) — a low-stakes leaf entity; the audit log preserves the change trail regardless (`SALON_HOLIDAY_DELETED`).

---

## 3. The Tenant/SalonProfile Composition Pattern

The central architectural decision this milestone makes (ADR-007): `Tenant` already **is** the salon in this single-location MVP (it already has `name`/`timezone`/`defaultLocale`/`addressLine1/2`/`city`/`countryCode`, exposed via `GET/PATCH /tenant` since Milestone 3). Rather than duplicating those columns onto a new `Salon`/`SalonProfile` table, `modules/salon`:

- Reaches `Tenant`'s fields **only** through `TenantsModule`'s exported `TenantService` (`salon.module.ts` imports `TenantsModule`) — never queries `prisma.tenant` directly, per the module-boundary rule (SYSTEM_ARCHITECTURE.md §2.3: "no module reaches into another module's Prisma models directly").
- Stores only the new fields (§2.2) on its own `SalonProfile` table, composed with `Tenant`'s fields at read time into one `SalonProfileView` (`application/salon-profile.service.ts`).

### `GET /salon` — upsert-on-read

Mirrors `TenantSettingsService.getSettings`'s existing precedent exactly: if no `SalonProfile` row exists yet for a tenant, one is created (`upsert(... create: { tenantId })`) rather than returning an in-memory default — a real row always exists after the first read, same as `TenantSettings`.

### `PATCH /salon` — split input, one transaction, one audit entry

The combined request DTO spans both Tenant-owned fields (`name`, `addressLine1`, `addressLine2`, `city`, `countryCode`, `timezone`, `defaultLocale`) and SalonProfile-owned fields (everything else). `SalonProfileService.updateProfile`:

1. Splits the input into `tenantFields`/`profileFields` (a pure function, no I/O).
2. Wraps both writes in one `prisma.$transaction`, calling `TenantService.updateProfile(tenantId, actor, tenantFields, tx)` and `SalonProfileRepositoryPort.upsert(tenantId, profileFields, tx)` only for the subset that's actually present — so a `PATCH` touching only branding fields never calls into `TenantService` at all.
3. Records one `SALON_PROFILE_UPDATED` audit entry after the transaction commits, with `metadata.changedFields`.

**The one deliberate touch to Milestone 3 code:** `TenantRepositoryPort.updateProfile` and `AuditLogService.record` both gained an **optional trailing `tx?: Prisma.TransactionClient` parameter** (defaults to the singleton `PrismaService`, so every pre-Milestone-4 call site is unaffected). This was necessary because `TenantService.updateProfile` writes its own `TENANT_PROFILE_UPDATED` audit entry as a side effect of being reused here — without threading `tx` through both the repository write *and* the audit write, a failure/rollback in the SalonProfile half of the transaction could leave a stale audit row claiming a Tenant-field change that never actually committed. Both `TenantService.updateProfile` and `AuditLogService.record` therefore accept and forward `tx` when given one.

**A `PATCH /salon` that changes both a Tenant field and a SalonProfile field produces two audit rows**, not one: `SALON_PROFILE_UPDATED` (this module's own, describing the salon-level action) and `TENANT_PROFILE_UPDATED` (written by the reused `TenantService.updateProfile` call). This is an accepted, deliberate consequence of reuse rather than duplicating `TenantService`'s update logic — a future engineer should not add a "skip audit" flag to `TenantService` just to suppress this; the redundancy is informative (one entry is the low-level fact, the other the salon-level narrative), not a bug.

**Not duplicated:** `SalonProfile` never grows its own `timezone`/`locale`/`name` columns "for convenience." If a future engineer is tempted to add one, that's the one thing this design explicitly guards against — it would silently reintroduce the two-sources-of-truth problem this whole composition pattern exists to avoid.

---

## 4. Composite-FK Cross-Tenant Pattern — Still Dormant

Per `docs/TENANT_ARCHITECTURE.md` §4.1 and `docs/adr/ADR-006`, the composite-FK pattern (`PRISMA_SCHEMA.md` §14.4) was flagged as "the Milestone-4-onward convention." It remains **dormant this milestone**: `SalonProfile`, `BusinessHours`, and `Holiday` all FK only to `Tenant` directly (exactly like the existing `TenantSettings`/`TenantInvitation`), never to another tenant-owned entity. No manual post-migration SQL was needed — both new composite unique indexes (`(tenantId, dayOfWeek)`, `(tenantId, date)`) are plain Prisma-native constraints. The pattern becomes load-bearing only once a future milestone introduces a real tenant-owned-to-tenant-owned relation (e.g. `Employee`↔`Service`).

---

## 5. Endpoints Reference

Base path `/api/v1/salon`. All controllers stack `JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard`; `TenantActiveGuard` is applied per mutating method only — reads stay reachable for a suspended tenant, mirroring `GET /tenant`'s existing exemption.

| Method | Path | Min Role | Permission | Notes |
|---|---|---|---|---|
| GET | `/salon` | STAFF | — | Composed Tenant+SalonProfile view; auto-vivifies a default `SalonProfile` row if none exists |
| PATCH | `/salon` | MANAGER | `salon:manage` | See §3 |
| GET | `/salon/business-hours` | STAFF | — | 7 entries; missing days defaulted in-memory to `{isClosed:true}`, never persisted by a GET |
| PUT | `/salon/business-hours` | MANAGER | `salon:manage` | Always the full 7-day week; `422 INVALID_BUSINESS_HOURS_SET` on a malformed set |
| GET | `/salon/holidays` | STAFF | — | Sorted by date ascending, no pagination (a handful of rows per tenant per year) |
| POST | `/salon/holidays` | MANAGER | `salon:manage` | `409 DUPLICATE_HOLIDAY_DATE` on a clashing date |
| PATCH | `/salon/holidays/:id` | MANAGER | `salon:manage` | `404` (never `403`) for cross-tenant/nonexistent, via `TenantScopedRepository` |
| DELETE | `/salon/holidays/:id` | MANAGER | `salon:manage` | Hard delete |

New RBAC permission key `salon:manage` (`backend/prisma/seed.ts`), granted to `OWNER` (via the existing "gets all permissions" mapping) and `MANAGER`. `STAFF` reads via role-check only, no permission needed — matching the read-broad/write-permission-gated pattern already established for `GET/PATCH /tenant`.

---

## 6. Frontend

`frontend/src/app/features/salon/` — three pages (`salon-profile-page`, `business-hours-page`, `holidays-page`), each a lazy-loaded route under `/app/salon*`. Deliberately **no `tenantActiveGuard` at the route level** (only `roleGuard` with `data:{roles:['STAFF']}`) — matches the backend's read/write split: view pages stay reachable for a suspended tenant, and mutation buttons are gated in-page via the existing `PermissionService.can('salon:manage')` signal, with the server-side `TenantActiveGuard` as the real enforcement.

Follows the existing `SettingsPage` precedent (plain component signals, no signal store — this feature is small enough not to need one) rather than `FRONTEND_ARCHITECTURE.md`'s full aspirational `pages/components/services/state/models` structure, which no shipped feature has actually used yet. `SalonApiService` lives in `core/api/` alongside `TenantApiService`, the one real precedent for a domain API service's location.

The holidays page uses inline add/edit forms (a row toggles into an editable state) rather than a modal dialog — `shared/components/primitives/` has no `Modal` yet, and a small create/edit form doesn't need one; introducing a new shared primitive for a single consumer would be premature.

`ApiClient` gained a `put<T>()` method (mirroring its existing `get`/`post`/`patch`/`delete`), needed for `PUT /salon/business-hours`'s full-week-replace semantics — its first consumer in this codebase.

---

## 7. Deferred / Known Gaps (Not Forgotten)

- **Logo upload is a placeholder** (`logoUrl` plain string) — no `Files`/S3 module exists yet. Wiring real upload is explicitly deferred to whichever future milestone builds `Files` (per the re-scoped `docs/IMPLEMENTATION_ROADMAP.md`).
- **`GET /tenant`'s dormant `logoUrl` field is now genuinely stale** relative to `GET /salon`'s real one — left as-is (one-line comment added) rather than wired up, since `TenantResponseDto` is Auth module's own summary shape, not this module's concern to fix.
- **Holiday partial-unique-index migration** — see §2.4's forward-compatibility note; a real requirement for whichever future milestone adds `employeeId` to `Holiday`, not a defect today.
- **No composite-FK exercise yet** — see §4; the pattern remains documented-but-dormant until a future cross-entity relation needs it.
- **`isRecurringAnnually` on `Holiday`** was considered and rejected for this milestone (adds availability-engine complexity disproportionate to a profile-only milestone) — noted in ADR-007 as a considered-and-rejected enhancement, not silently dropped.

---

## 8. Files

**Backend, new:** `backend/src/modules/salon/**` (domain/application/infrastructure/interface layers, mirroring `modules/tenants`' structure exactly), `backend/test/unit/salon/**`, `backend/test/integration/salon/**`, `backend/prisma/migrations/20260722104304_milestone_4_salon_management/`.

**Backend, modified:** `backend/prisma/schema.prisma` (+3 models, +3 `Tenant` back-relations), `backend/prisma/seed.ts` (+`salon:manage` permission), `backend/src/app.module.ts` (+`SalonModule`), `backend/src/core/audit/audit-log.service.ts` (+optional `tx` param), `backend/src/modules/tenants/domain/ports/tenant-repository.port.ts` + `infrastructure/prisma-tenant.repository.ts` (+optional `tx` param on `updateProfile`), `backend/src/modules/tenants/application/tenant.service.ts` (+optional `tx` param, threaded through), `backend/src/modules/auth/interface/dto/tenant-response.dto.ts` (comment only).

**Frontend, new:** `frontend/src/app/features/salon/**`, `frontend/src/app/core/api/salon-api.service.ts`, `frontend/src/app/shared/models/{salon,business-hours,holiday}.model.ts`.

**Frontend, modified:** `frontend/src/app/app.routes.ts` (+3 routes), `frontend/src/app/core/api/api-client.ts` (+`put<T>()`), `frontend/src/app/layouts/dashboard-layout/dashboard-layout.html` (+"Salon" nav link), `frontend/src/app/shared/constants/role-permissions.constant.ts` (+`salon:manage`).
