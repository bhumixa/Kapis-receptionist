# SERVICE_ARCHITECTURE.md

## Service Catalog — Implementation Reference

**Document Status:** As-Built
**Milestone:** 5 — Workforce & Service Catalog
**Depends on:** SYSTEM_ARCHITECTURE.md §2.3–2.4, DATABASE_DESIGN.md, PRISMA_SCHEMA.md §5/§14.4, API_SPECIFICATION.md, docs/TENANT_ARCHITECTURE.md, docs/WORKFORCE_ARCHITECTURE.md, docs/adr/ADR-008-workforce-and-service-catalog.md
**Scope:** What this milestone built for the service catalog — `ServiceCategory` and `Service` CRUD, including duration, pricing, and per-service buffer time. Employee↔Service eligibility assignment is owned by `modules/employees` and documented in docs/WORKFORCE_ARCHITECTURE.md, not here — see ADR-008 decision #1 for why. Customers, Files/S3 upload, Scheduling, WhatsApp, AI, Billing, and Analytics are explicitly out of scope — see docs/adr/ADR-008.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Service category CRUD | `GET/POST/PATCH/DELETE /service-categories[/:id]` | `modules/services` |
| Service catalog CRUD (duration, pricing, buffer time) | `GET/POST/PATCH/DELETE /services[/:id]` | `modules/services` |
| Service catalog / category management UI | `/app/services`, `/app/services/categories` | `frontend/features/services` |

Employee↔Service eligibility assignment (`PUT /employees/:id/services`, `GET /employees?filter[serviceId]=`) is built and documented under `modules/employees`/docs/WORKFORCE_ARCHITECTURE.md — this module exposes only the read/validation surface (`ServiceService.findByIdsForTenant`) that `modules/employees` consumes.

Not built (deliberately, this milestone): Customers, Files/S3 upload, Scheduling, WhatsApp, AI, Billing, Analytics. Flagged in ADR-008, not a silent gap.

---

## 2. Data Model

### 2.1 `ServiceCategory`

```prisma
model ServiceCategory {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @db.Uuid
  name         String    @db.VarChar(100)
  displayOrder Int       @default(0)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?
}
```

Optional grouping only — a `Service` may have a `null` categoryId. Soft-deletable (`deletedAt`); deleting a category un-categorizes its services (`Service.category` is `onDelete: SetNull`) rather than deleting them, since losing a display grouping is a UI concern, not a data-loss event.

### 2.2 `Service`

```prisma
model Service {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String    @db.Uuid
  categoryId        String?   @db.Uuid
  name              String    @db.VarChar(150)
  description       String?   @db.Text
  durationMinutes   Int
  priceCents        Int
  currency          String    @default("USD") @db.Char(3)
  bufferTimeMinutes Int       @default(0)
  isActive          Boolean   @default(true)
  displayOrder      Int       @default(0)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?

  @@unique([tenantId, id], name: "uq_services_tenant_id")
  @@index([tenantId, isActive], name: "idx_services_tenant_active")
}
```

Matches `docs/PRISMA_SCHEMA.md` §5's already-designed shape, plus one new field:

- **`bufferTimeMinutes`** (new, Milestone 5, default `0`) — a per-service cleanup/prep buffer (e.g., color-treatment processing time), distinct from `TenantSettings.business.bookingBufferMinutes` (already reserved, still dormant, for a future tenant-wide minimum gap between any two bookings). See ADR-008 decision #4 for the reasoning. Both fields are independent inputs a future Availability engine (Milestone 6) will compose — this milestone does not implement that composition, since no Availability engine exists yet.
- **`@@unique([tenantId, id])`** (new, Milestone 5) — the composite-FK cross-tenant pattern's referenced side; see §3.
- **Soft-deletable** — a retired service's historical `AppointmentService` snapshot rows (a future milestone) must survive; `isActive: false` (via `PATCH`) is the normal "hide from booking" toggle, `DELETE` (soft) is for permanently retiring a service from the catalog.
- Editing `priceCents`/`durationMinutes` never rewrites historical booking snapshots — stated explicitly since it's the single most likely point of confusion for a future frontend implementer expecting a price edit to retroactively "fix" a past invoice display (no such snapshot exists yet at this milestone, but the rule holds once Appointments does).

---

## 3. Composite-FK Cross-Tenant Pattern — First Real Consumer

Per `docs/TENANT_ARCHITECTURE.md` §4.1, the composite-FK pattern was flagged as "the Milestone-4-onward convention, becoming load-bearing starting `Employee`↔`Service`." This milestone is that moment: `Service.@@unique([tenantId, id])` (this table) plus `Employee.@@unique([tenantId, id])` (docs/WORKFORCE_ARCHITECTURE.md §2.1) let `EmployeeService`'s two relations be declared as compound FKs:

```prisma
employee Employee @relation(fields: [tenantId, employeeId], references: [tenantId, id], onDelete: Cascade)
service  Service  @relation(fields: [tenantId, serviceId], references: [tenantId, id], onDelete: Cascade)
```

**Discovery worth recording:** `docs/PRISMA_SCHEMA.md` §14.4 listed this as a constraint requiring a manual post-generation SQL edit. It does not — `prisma migrate dev` generated the compound foreign keys directly from the declarative schema above (verified in the generated migration SQL: `ALTER TABLE "employee_services" ADD CONSTRAINT ... FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id")`). Modern Prisma supports multi-field relations against a compound unique/`@@id` natively. See ADR-008 decision #3 — this correction is now the authoritative guidance for any future module modeling its own tenant-owned-to-tenant-owned relation.

The database itself rejects a cross-tenant `(employeeId, serviceId)` pairing as a result — proven directly (bypassing the application layer entirely) in `test/integration/employees/employee-service-assignment.integration-spec.ts`'s composite-FK test.

---

## 4. Endpoints Reference

Base path `/api/v1`. All controllers stack `JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard`; `TenantActiveGuard` is applied per mutating method only — reads stay reachable for a suspended tenant, mirroring `GET /salon`'s existing exemption.

| Method | Path | Min Role | Permission | Notes |
|---|---|---|---|---|
| GET | `/service-categories` | STAFF | — | Sorted by `displayOrder` ascending |
| POST | `/service-categories` | MANAGER | `services:manage` | |
| PATCH | `/service-categories/:id` | MANAGER | `services:manage` | `404` (never `403`) for cross-tenant/nonexistent |
| DELETE | `/service-categories/:id` | MANAGER | `services:manage` | Soft delete; un-categorizes services, never deletes them |
| GET | `/services` | STAFF | — | Offset pagination (`API_SPECIFICATION.md` §2.4.2); `filter` via `isActive`/`categoryId` query params, `q` searches name/description, `sort` on `name`/`priceCents`/`displayOrder` (default `displayOrder` asc) |
| GET | `/services/:id` | STAFF | — | No hydrated eligible-employees field (ADR-008 decision #2) |
| POST | `/services` | MANAGER | `services:manage` | Validates `categoryId` belongs to the tenant (`422 INVALID_CATEGORY_REFERENCE`) |
| PATCH | `/services/:id` | MANAGER | `services:manage` | `categoryId: null` un-categorizes |
| DELETE | `/services/:id` | MANAGER | `services:manage` | Soft delete |

New RBAC permission key `services:manage` (`backend/prisma/seed.ts`), granted to `OWNER` (all-permissions mapping) and `MANAGER`. `STAFF` reads via role-check only — matches the read-broad/write-permission-gated pattern established since `salon:manage`.

---

## 5. Frontend

`frontend/src/app/features/services/` — two pages (`services-list-page`, `service-categories-page`), each a lazy-loaded route under `/app/services*`. Follows the `SalonProfilePage`/`HolidaysPage` precedent (plain component signals, inline add/edit rows, no signal store, no shared `Modal`) — see ADR-008 decision #7.

- **Services list** — inline create form (name, category select, duration, price, buffer time), a table with inline-edit rows (mirrors `HolidaysPage`'s toggle-to-editable-row pattern) and an inline `isActive` quick-toggle button (per `FRONTEND_ARCHITECTURE.md` §6.5's stated UX).
- **Categories** — a simpler list + inline add/edit/delete, identical shape to `HolidaysPage`.
- Both pages fetch a single generous-limit page (`limit=100`) rather than building pagination UI — same precedent as `AdminApiService.listTenants` (ADR-008 decision #6), appropriate for a per-tenant catalog realistically dozens of rows.
- `ServicesApiService` lives in `core/api/`, mirroring `SalonApiService`'s location/shape.

---

## 6. Deferred / Known Gaps (Not Forgotten)

- **No eligible-employees field on `GET /services/:id`** — the reverse of `GET /employees?filter[serviceId]=`, deliberately not built to avoid a `Services → Employees` module cycle (ADR-008 decision #2). Revisit only if a genuine UI need for that specific direction emerges.
- **Buffer-time composition with `TenantSettings.business.bookingBufferMinutes`** — both fields exist independently; no Availability engine exists yet to compose them. A real requirement for Milestone 6, not a defect today.
- **`EMPLOYEE_HAS_UPCOMING_APPOINTMENTS`-equivalent guardrail for Services** (e.g., blocking deactivation of a service with future bookings) — not applicable yet, no `Appointment` table exists (Milestone 6 scope, same reasoning as docs/WORKFORCE_ARCHITECTURE.md §6).
- **Customers, Files/S3 upload** — explicitly deferred; see ADR-008.

---

## 7. Files

**Backend, new:** `backend/src/modules/services/**` (domain/application/infrastructure/interface layers, mirroring `modules/salon`'s structure exactly), `backend/test/unit/services/**`, `backend/test/integration/services/**`.

**Backend, modified:** `backend/prisma/schema.prisma` (+`ServiceCategory`, `Service` models, +`Tenant` back-relations), `backend/prisma/migrations/<timestamp>_milestone_5_workforce_and_service_catalog/`, `backend/prisma/seed.ts` (+`services:manage` permission), `backend/src/app.module.ts` (+`ServicesModule`).

**Frontend, new:** `frontend/src/app/features/services/**`, `frontend/src/app/core/api/services-api.service.ts`, `frontend/src/app/shared/models/{service,service-category}.model.ts`.

**Frontend, modified:** `frontend/src/app/app.routes.ts` (+2 routes), `frontend/src/app/layouts/dashboard-layout/dashboard-layout.html` (+"Services" nav link), `frontend/src/app/shared/constants/role-permissions.constant.ts` (+`services:manage`).
