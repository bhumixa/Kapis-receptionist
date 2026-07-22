# WORKFORCE_ARCHITECTURE.md

## Employees — Implementation Reference

**Document Status:** As-Built
**Milestone:** 5 — Workforce & Service Catalog
**Depends on:** SYSTEM_ARCHITECTURE.md §2.3–2.4, DATABASE_DESIGN.md, PRISMA_SCHEMA.md §5/§14.4, API_SPECIFICATION.md, docs/TENANT_ARCHITECTURE.md, docs/SERVICE_ARCHITECTURE.md, docs/adr/ADR-006-multi-tenant-saas-engine.md, docs/adr/ADR-008-workforce-and-service-catalog.md
**Scope:** What this milestone built for the workforce domain — employee profile/status CRUD, per-employee working hours, per-employee time off/leave, and Employee↔Service eligibility assignment. Customers, Files/S3 upload, Scheduling, WhatsApp, AI, Billing, and Analytics are explicitly out of scope — see docs/adr/ADR-008.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Employee CRUD, profile, status | `GET/POST/PATCH/DELETE /employees[/:id]` | `modules/employees` |
| Employee working hours (recurring weekly template, split shifts allowed) | `GET/PUT /employees/:id/working-hours` | `modules/employees` |
| Employee time off / leave (date range) | `GET/POST/DELETE /employees/:id/time-off[/:id]` | `modules/employees` |
| Employee ↔ Service assignment | `PUT /employees/:id/services` | `modules/employees` |
| Employee management, profile, working-hours editor, time-off, and assignment UI | `/app/employees`, `/app/employees/:id` | `frontend/features/employees` |

Not built (deliberately, this milestone): Customers, Files/S3 upload (no real avatar upload — none was requested), Scheduling, WhatsApp, AI, Billing, Analytics. All flagged in ADR-008, not silent gaps.

---

## 2. Data Model

### 2.1 `Employee`

```prisma
model Employee {
  id            String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String         @db.Uuid
  userId        String?        @unique @db.Uuid
  firstName     String         @db.VarChar(100)
  lastName      String         @db.VarChar(100)
  phoneNumber   String?        @db.VarChar(20)
  status        EmployeeStatus @default(ACTIVE)
  colorTag      String?        @db.VarChar(7)
  bio           String?        @db.Text
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?
  deletedByType ActorType?
  deletedById   String?        @db.Uuid

  @@unique([tenantId, id], name: "uq_employees_tenant_id")
  @@index([tenantId, status], name: "idx_employees_tenant_status")
}

enum EmployeeStatus {
  ACTIVE
  ON_LEAVE
  INACTIVE
}
```

A schedulable staff resource, distinct from `User` login access — `userId` is an optional 1:1 link to an existing `User` in the same tenant (`onDelete: SetNull` — if the linked login account is ever hard-deleted, the employee record survives as a resource, just without dashboard access). Soft-deletable, matching `User`'s own pattern (`deletedByType`/`deletedById`). `@@unique([tenantId, id])` is the composite-FK pattern's referenced side (§4).

**`userId` validation** (docs/adr/ADR-008 decision #5): no dedicated `Users` module exists yet in this codebase, so `EmployeeService` (application layer) validates `userId` by injecting the shared `PrismaService` directly (`prisma.user.findFirst({ id, tenantId, deletedAt: null })`), plus a `findByUserIdForTenant` check on the `Employee` repository to reject a `userId` already linked to a different employee (`409 USER_ALREADY_LINKED`). This is a narrow, documented exception to the module-boundary convention, flagged for a future `Users` module to absorb.

### 2.2 `WorkingHours`

```prisma
model WorkingHours {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String   @db.Uuid
  dayOfWeek  Int      @db.SmallInt // 0=Sunday..6=Saturday
  startTime  DateTime @db.Time
  endTime    DateTime @db.Time
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

Matches `docs/PRISMA_SCHEMA.md` §5's already-designed shape exactly. Unlike the salon-wide `BusinessHours` (always exactly 7 rows, one per day), `WorkingHours` has **no day-uniqueness constraint** — any number of entries per day (split shifts) or zero entries (a day off) are valid. `PUT /employees/:id/working-hours` is a full-replace of the employee's entire set (delete-then-insert in one transaction), not a per-row `PATCH`.

**Wall-clock storage, not timezone-aware** — same convention as `BusinessHours`/`Holiday`: `startTime`/`endTime` are `"HH:mm"` strings at the domain/API layer; the mapper (`infrastructure/mappers/prisma-employee.mappers.ts`) reads/writes via UTC accessors, never local-time accessors.

### 2.3 `EmployeeTimeOff`

```prisma
model EmployeeTimeOff {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String   @db.Uuid
  startDate  DateTime @db.Date
  endDate    DateTime @db.Date
  reason     String?  @db.VarChar(255)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([tenantId, employeeId], name: "idx_employee_time_off_tenant_employee")
}
```

A **new, dedicated model** (not an extension of Milestone 4's `Holiday` table) — see docs/adr/ADR-008 decision #6 for the full reasoning: extending `Holiday` with a nullable `employeeId` (as `docs/adr/ADR-007-salon-management.md`'s forward note anticipated) would have required a manual partial-unique-index migration and touched Milestone 4's already-shipped schema/tests, for a feature (a date **range**, not a single closure date) that is conceptually distinct from a salon-wide closure calendar. `EmployeeTimeOff` has no tenant-wide-duplicate concept to protect against, so it needs no partial unique index at all — a plain `create`/`delete` is sufficient. Validation: `endDate >= startDate` (`422 INVALID_TIME_OFF_RANGE`); a single-day range (`startDate === endDate`) is valid.

**Deletion is a hard delete** — a low-stakes leaf entity, matching `Holiday`'s own precedent; the audit log preserves the change trail regardless (`EMPLOYEE_TIME_OFF_DELETED`).

### 2.4 `EmployeeService` (junction)

```prisma
model EmployeeService {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String   @db.Uuid
  serviceId  String   @db.Uuid
  createdAt  DateTime @default(now())

  employee Employee @relation(fields: [tenantId, employeeId], references: [tenantId, id], onDelete: Cascade)
  service  Service  @relation(fields: [tenantId, serviceId], references: [tenantId, id], onDelete: Cascade)

  @@unique([employeeId, serviceId], name: "uq_employee_services_employee_service")
}
```

Which employees are eligible to perform which services — the skill-matching data a future Availability engine (Milestone 6) will depend on. Owned by `modules/employees` (docs/adr/ADR-008 decision #1) despite referencing `Service`, since the assignment mutation (`PUT /employees/:id/services`) is always initiated from the employee side. See docs/SERVICE_ARCHITECTURE.md §3 for the composite-FK mechanics this junction is the first real consumer of.

---

## 3. Module Boundary — One-Directional `Employees → Services`

`SYSTEM_ARCHITECTURE.md`'s module-dependency graph literally lists `Employees → Services` **and** `Services → Employees` — a genuine cycle. This milestone resolves it as **one direction only**: `EmployeesModule` imports `ServicesModule` (to validate `serviceIds` via `ServiceService.findByIdsForTenant` and reject a cross-tenant/nonexistent id with `422 INVALID_SERVICE_REFERENCE`); `ServicesModule` never imports `EmployeesModule`. See docs/adr/ADR-008 decision #1/#2 for the full reasoning and its one visible consequence (`GET /services/:id` has no hydrated eligible-employees field).

`EmployeeAssignmentService` (`modules/employees/application/`) is the concrete seam: it injects both the `EmployeeServiceRepositoryPort` (this module's own junction table) and `ServicesModule`'s exported `ServiceService`, and is the sole place `EmployeeService` rows are written.

---

## 4. Composite-FK Cross-Tenant Pattern

See docs/SERVICE_ARCHITECTURE.md §3 for the full mechanics (this is the same pattern, documented once rather than twice). Summary: `Employee`/`Service` each carry `@@unique([tenantId, id])`; `EmployeeService`'s two relations use compound `@relation(fields: [tenantId, xId], references: [tenantId, id])`, generated natively by `prisma migrate dev` with no manual SQL required — a correction to `docs/PRISMA_SCHEMA.md` §14.4's original assumption, recorded in ADR-008 decision #3.

---

## 5. Endpoints Reference

Base path `/api/v1`. All controllers stack `JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard`; `TenantActiveGuard` is applied per mutating method only.

| Method | Path | Min Role | Permission | Notes |
|---|---|---|---|---|
| GET | `/employees` | STAFF | — | Offset pagination; `filter` via `status`/`serviceId` (eligibility join), `q` searches first/last name, `sort` on `firstName`/`status` (default `firstName` asc) |
| GET | `/employees/:id` | STAFF | — | Includes `serviceIds` |
| POST | `/employees` | MANAGER | `employees:manage` | Accepts `serviceIds`/`userId` optionally; `422 INVALID_USER_REFERENCE`, `409 USER_ALREADY_LINKED`, `422 INVALID_SERVICE_REFERENCE` |
| PATCH | `/employees/:id` | MANAGER | `employees:manage` | `userId: null` unlinks; a `status` transition records `EMPLOYEE_STATUS_CHANGED` instead of `EMPLOYEE_UPDATED` |
| DELETE | `/employees/:id` | MANAGER | `employees:manage` | Soft delete |
| PUT | `/employees/:id/services` | MANAGER | `employees:manage` | Full-replace of eligibility |
| GET | `/employees/:id/working-hours` | STAFF | — | Any number of entries, ordered by day then start time |
| PUT | `/employees/:id/working-hours` | MANAGER | `employees:manage` | Full-replace; `422 INVALID_WORKING_HOURS_ENTRY` for an out-of-range `dayOfWeek` or `endTime <= startTime` on an active entry |
| GET | `/employees/:id/time-off` | STAFF | — | Sorted by `startDate` ascending |
| POST | `/employees/:id/time-off` | MANAGER | `employees:manage` | `422 INVALID_TIME_OFF_RANGE` if `endDate < startDate` |
| DELETE | `/employees/:id/time-off/:id` | MANAGER | `employees:manage` | Hard delete |

New RBAC permission key `employees:manage` (`backend/prisma/seed.ts`), granted to `OWNER` and `MANAGER`. `STAFF` reads via role-check only.

---

## 6. Deferred / Known Gaps (Not Forgotten)

- **`EMPLOYEE_HAS_UPCOMING_APPOINTMENTS` guardrail** (named in `API_SPECIFICATION.md` §7 for `PATCH`/`DELETE /employees/:id`) — not implemented. No `Appointment` table exists anywhere in the schema yet; `IMPLEMENTATION_ROADMAP.md`'s Sprint 5.1 risk note already anticipated this, flagging it as a Milestone 6 follow-up requiring an explicit regression test once `Appointment` exists — not a silently-skipped requirement.
- **No composite-FK exercise on `WorkingHours`/`EmployeeTimeOff`** — both reference only `Employee` (a single tenant-owned entity, not a cross-two-tenant-owned-entity join), so the composite-FK pattern doesn't apply to them; standard single-column FK + tenant-scoped queries are sufficient, consistent with `TenantInvitation`'s existing precedent for single-entity references.
- **`Employee.userId` validation via direct `PrismaService` injection** — a temporary, documented exception (§2.1); a future `Users` module should absorb this check.
- **Customers, Files/S3 upload** — explicitly deferred; see ADR-008.

---

## 7. Files

**Backend, new:** `backend/src/modules/employees/**` (domain/application/infrastructure/interface layers, mirroring `modules/salon`'s structure exactly), `backend/test/unit/employees/**`, `backend/test/integration/employees/**`.

**Backend, modified:** `backend/prisma/schema.prisma` (+`EmployeeStatus` enum, +`Employee`, `WorkingHours`, `EmployeeTimeOff`, `EmployeeService` models, +`Tenant`/`User` back-relations), `backend/prisma/migrations/<timestamp>_milestone_5_workforce_and_service_catalog/`, `backend/prisma/seed.ts` (+`employees:manage` permission), `backend/src/app.module.ts` (+`EmployeesModule`).

**Frontend, new:** `frontend/src/app/features/employees/**`, `frontend/src/app/core/api/employees-api.service.ts`, `frontend/src/app/shared/models/{employee,working-hours,employee-time-off}.model.ts`.

**Frontend, modified:** `frontend/src/app/app.routes.ts` (+2 routes), `frontend/src/app/layouts/dashboard-layout/dashboard-layout.html` (+"Employees" nav link), `frontend/src/app/shared/constants/role-permissions.constant.ts` (+`employees:manage`).
