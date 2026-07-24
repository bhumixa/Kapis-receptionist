# SCHEDULING_ARCHITECTURE.md

## Customers, Availability & Appointments — Implementation Reference

**Document Status:** As-Built
**Milestone:** 6 — Appointment & Scheduling Engine
**Depends on:** SYSTEM_ARCHITECTURE.md §3.2 (`Appointments`/`Availability`/`Customers` modules), DATABASE_DESIGN.md §3.5/§10.4/Risk DB-R3, PRISMA_SCHEMA.md §7/§14.4, API_SPECIFICATION.md §9–10, docs/TENANT_ARCHITECTURE.md §4.1, docs/WORKFORCE_ARCHITECTURE.md, docs/SERVICE_ARCHITECTURE.md, docs/adr/ADR-009-scheduling-engine.md
**Scope:** Customer CRUD; the Availability slot-computation engine; the Appointment booking lifecycle (create, cancel, reschedule, list, get); the two-layer booking-conflict-prevention mechanism; a generic `Idempotency-Key` interceptor and cursor-pagination utility (both reusable beyond this milestone). See docs/CALENDAR_ENGINE.md for the frontend calendar specifically.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Customer CRUD | `GET/POST/PATCH/DELETE /customers[/:id]` | `modules/customers` |
| Availability slot computation | `GET /appointments/availability` | `modules/availability` (no controller of its own — served from `AppointmentsController`) |
| Appointment create (multi-service, per-service employee assignment) | `POST /appointments` | `modules/appointments` |
| Appointment list / get (cursor pagination, STAFF scoped to own bookings) | `GET /appointments[/:id]` | `modules/appointments` |
| Appointment notes update | `PATCH /appointments/:id` | `modules/appointments` |
| Appointment cancel | `POST /appointments/:id/cancel` | `modules/appointments` |
| Appointment reschedule (reschedule-chain, optional employee reassignment per line) | `POST /appointments/:id/reschedule` | `modules/appointments` |
| Appointment hard-remove (data-entry-error correction, OWNER only) | `DELETE /appointments/:id` | `modules/appointments` |
| Customer/appointment/calendar UI | `/app/customers`, `/app/appointments`, `/app/appointments/new`, `/app/appointments/:id` | `frontend/features/{customers,appointments}` |

Not built (deliberately, this milestone — docs/adr/ADR-009): `AppointmentReminder`/any BullMQ reminder worker, `AppointmentFeedback`, `CustomerTag`/`CustomerNote`/`CustomerPreference`, any WhatsApp/AI/`Conversation` linkage on `Appointment`.

---

## 2. Data Model

### 2.1 `Customer`

```prisma
model Customer {
  id                String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String     @db.Uuid
  phoneNumber       String     @db.VarChar(20)
  firstName         String?    @db.VarChar(100)
  lastName          String?    @db.VarChar(100)
  email             String?    @db.VarChar(255)
  preferredLanguage String?    @db.VarChar(10)
  marketingOptIn    Boolean    @default(false)
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  deletedAt         DateTime?
  deletedByType     ActorType?
  deletedById       String?    @db.Uuid

  @@unique([tenantId, id], name: "uq_customers_tenant_id")
  @@index([tenantId, phoneNumber], name: "idx_customers_tenant_phone")
}
```

Scoped down from PRISMA_SCHEMA.md's full Customer domain — no `CustomerTag`/`CustomerNote`/`CustomerPreference` this milestone (docs/adr/ADR-009). No `createdByType`/`createdById`/`updatedByType`/`updatedById` — mirrors the as-built `Employee`/`Service` precedent (Milestone 5 dropped these); `AppointmentStatusHistory` is the audit trail for `Appointment`, but `Customer` itself has no equivalent history table, so its own `CUSTOMER_*` `AuditLog` entries are the sole attribution record.

**Partial unique index** (manual migration, PRISMA_SCHEMA.md §14.4's established mechanism): `uq_customers_tenant_phone` on `(tenantId, phoneNumber) WHERE deletedAt IS NULL` — two rows may legitimately share a phone number once one is soft-deleted; the plain `@@unique` Prisma's schema DSL would otherwise generate does not admit that.

### 2.2 `Appointment` / `AppointmentService` / `AppointmentStatusHistory`

```prisma
model Appointment {
  id                            String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                      String            @db.Uuid
  customerId                    String            @db.Uuid
  employeeId                    String            @db.Uuid   // denormalized "primary" — see below
  status                        AppointmentStatus @default(CONFIRMED)
  startTime                     DateTime
  endTime                       DateTime
  totalPriceCents               Int
  currency                      String            @default("USD") @db.Char(3)
  notes                         String?           @db.Text
  cancellationReason            String?           @db.VarChar(255)
  cancelledAt                   DateTime?
  rescheduledFromAppointmentId  String?           @db.Uuid

  @@unique([tenantId, id], name: "uq_appointments_tenant_id")
  @@index([tenantId, employeeId, startTime], name: "idx_appointments_tenant_employee_start")
  @@index([tenantId, customerId], name: "idx_appointments_tenant_customer")
  @@index([tenantId, status, startTime], name: "idx_appointments_tenant_status_start")
}

model AppointmentService {
  id                      String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String   @db.Uuid
  appointmentId           String   @db.Uuid
  serviceId               String   @db.Uuid
  employeeId              String   @db.Uuid
  serviceNameSnapshot     String   @db.VarChar(150)
  durationMinutesSnapshot Int
  priceCentsSnapshot      Int
  bufferMinutesSnapshot   Int      @default(0)
  sequenceOrder           Int      @default(0) @db.SmallInt
  startTime               DateTime
  endTime                 DateTime
  blockedUntil            DateTime
  isBlocking              Boolean  @default(true)

  @@index([tenantId, employeeId, startTime], name: "idx_appointment_services_tenant_employee_start")
}

model AppointmentStatusHistory {
  id            String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String                   @db.Uuid
  appointmentId String                   @db.Uuid
  action        AppointmentHistoryAction
  previousState Json?
  newState      Json
  actorType     ActorType
  actorId       String?                  @db.Uuid
}
```

**Per-service employee assignment** (confirmed decision, docs/adr/ADR-009): a single visit can have different services performed by different employees in sequence — the AI/WhatsApp-facing "book me a haircut" flow this schema also anticipates (future milestones) is not the only booking shape; a color treatment followed by a cut with a different stylist is a normal salon visit. Consequences:

- `Appointment.employeeId` is a **denormalized "primary"** value only (the first `sequenceOrder` line's employee) — convenient for `filter[employeeId]` queries and calendar display, **never** authoritative for conflict/availability.
- Each `AppointmentService` line owns its own `[startTime, endTime)` sub-window, computed **sequentially** at booking time (no gap between lines within one continuous visit: `line[i+1].startTime = line[i].endTime`), and its own `employeeId`.
- `blockedUntil` = `line.endTime + bufferMinutesSnapshot` — the actual range that employee is unavailable for their *next* booking. `bufferMinutesSnapshot` is computed once, at booking time, via `AvailabilityService.effectiveBufferMinutes` (§4).
- `isBlocking` starts `true` and is flipped to `false` — in the same transaction as the parent `Appointment`'s status change — whenever the appointment is cancelled, rescheduled (the *original* appointment's lines), or hard-removed. This denormalized flag exists because the database-level `EXCLUDE` constraint (§3) cannot reach across tables to consult `Appointment.status`/`deletedAt`.

**Reschedule chain**: `rescheduledFromAppointmentId` is a **composite FK** (`(tenantId, rescheduledFromAppointmentId) REFERENCES appointments(tenantId, id)`, `onDelete: Restrict`) — a self-relation sharing the required `tenantId` scalar with `Appointment`'s other two composite relations (`customer`, `employee`). `onDelete: Restrict`, not `SetNull`: Prisma warns against `SetNull` on a composite relation that includes a required column (`tenantId` can never legitimately become null), and `Restrict` is also the semantically correct choice — an appointment that's been rescheduled *into* should never be removable while the row it superseded still points at it. Rescheduling creates a **new** `Appointment` row (never an in-place mutation of `startTime`), matching DATABASE_DESIGN.md §9.2's explicit design — both the original (now `RESCHEDULED`) and the new row persist as distinct historical facts, each with its own `AppointmentStatusHistory` row referencing the other via `previousState`/`newState` JSON.

**Composite-FK pattern usage** (docs/TENANT_ARCHITECTURE.md §4.1): `Appointment.customer`/`.employee`/`.rescheduledFrom`, and `AppointmentService.service`/`.employee` all use the compound `(tenantId, id)` pattern — every one of them references an independent tenant-owned entity. `AppointmentService.appointmentId` is deliberately a **plain** (non-composite) FK — parent/child ownership (same precedent as `WorkingHours.employeeId` → `Employee`), not a cross-entity relation. Generated natively by `prisma migrate dev` with no manual SQL edit, the second confirmation of ADR-008's correction to PRISMA_SCHEMA.md §14.4's original "manual migration required" assumption.

**`AppointmentStatusHistory.id`** uses standard `gen_random_uuid()`, not app-generated UUIDv7 — see docs/adr/ADR-009 for why (matches the `AuditLog` precedent; no `uuidv7` dependency exists in this project).

---

## 3. Booking-Conflict Prevention (Two Layers, Exactly as Designed)

PRISMA_SCHEMA.md §14.4 and DATABASE_DESIGN.md §10.4/Risk DB-R3 specified two independent layers; both are built, neither is a stand-in for the other.

**Layer 1 — Redis distributed lock** (`core/locking/booking-lock.service.ts`, `BookingLockService`): `SET NX PX` on `lock:availability:{tenantId}:{employeeId}`, a ~5-second TTL. Every write path (`createAppointment`, `rescheduleAppointment`) acquires one lock per **distinct** `employeeId` across all lines in the request, sorted before acquisition so two concurrent requests involving overlapping employees always attempt to acquire in the same global order (deadlock avoidance). All-or-nothing: any failed acquisition releases everything acquired so far in that call and raises `SlotNoLongerAvailableException`. Release uses a Lua script checking a per-acquisition token before deleting, so a lock that expired and was re-acquired by a different request is never released out from under its new legitimate holder. Reuses the existing shared `RedisService` connection (its own doc comment already names "distributed locks" as one of its intended uses) — no Redlock dependency, appropriate for a single Redis instance.

**Layer 2 — Database `EXCLUDE` constraint** (manual migration, `20260722230701_milestone_6_scheduling_engine`):

```sql
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE "appointment_services"
  ADD CONSTRAINT "excl_appointment_services_employee_time"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tsrange("startTime", "blockedUntil") WITH &&
  )
  WHERE ("isBlocking");
```

Scoped to `appointment_services` (not `appointments`) — per-service employee assignment means each line is independently blocking, not the whole appointment. `tsrange`, not `tstzrange` — every `DateTime` column in this schema is Prisma's default `TIMESTAMP` (confirmed against every prior migration before writing this one; no `@db.Timestamptz` exists anywhere in this project). This is the database-level backstop if the Redis lock is ever bypassed, expires mid-transaction, or a bug in the application layer skips it — the actual correctness guarantee, not just a performance optimization.

**Application-layer pre-flight check**: between the two, `AvailabilityService.isWindowAvailable` (§4) checks each line's proposed window against both working-hours compliance and existing bookings *before* attempting the insert, so the common case produces a clean `409 SLOT_NO_LONGER_AVAILABLE` rather than a raw Postgres constraint-violation error surfacing through the stack. `AppointmentsService` also catches an `EXCLUDE`-constraint violation (matched by constraint name in the error message) at the repository-call boundary and maps it to the same exception, so even the rare race the pre-flight check misses still resolves to the correct client-facing error.

**Verified, not assumed**: `test/integration/appointments/appointments-concurrency.integration-spec.ts` fires 8 concurrent `POST /appointments` requests at the same employee/slot, each with its own distinct `Idempotency-Key` (so they genuinely race rather than replay each other) — exactly one succeeds, the other 7 receive `409 SLOT_NO_LONGER_AVAILABLE`, confirmed against the real database (`prisma.appointment.count()`) and real Redis, not mocked. This test surfaced and drove the fix for a genuine pre-existing race condition in `TenantSettingsService.getSettings()` — see docs/adr/ADR-009's "A Genuine Bug Found and Fixed" section.

---

## 4. Availability Engine

`modules/availability` (`AvailabilityService`) — pure computation, no Prisma model or controller of its own beyond one narrow, documented exception (below). Consumed by `AppointmentsController` (`GET /appointments/availability`) and by `AppointmentsService` itself (per-line validation at booking/reschedule time — never trusting a prior `GET` call, per API_SPECIFICATION.md Section 10).

**Inputs, read through each owning module's exported public service** (never another module's Prisma model directly, per the module-boundary rule): `Employee`/`EmployeeService` eligibility (`modules/employees`' `EmployeeService`/`EmployeeAssignmentService`), `WorkingHours` (`WorkingHoursService`), `EmployeeTimeOff` (`EmployeeTimeOffService`), `BusinessHours`/`Holiday` (`modules/salon`'s `BusinessHoursService`/`HolidayService`), `TenantSettings.business` (`modules/tenants`' `TenantSettingsService`), `Service` (`modules/services`' `ServiceService`).

**One narrow, documented exception**: reads `appointment_services` directly via the shared, global `PrismaService` rather than importing `AppointmentsModule` — see docs/adr/ADR-009's table for the full reasoning (the same `Availability<->Appointments` cycle ADR-008 already hit for `Employees<->Services`, resolved the same one-directional way: `AppointmentsModule` imports `AvailabilityModule`, never the reverse).

**Slot generation** (`getAvailableSlots`): for each eligible `ACTIVE` employee and each calendar day in the requested range (capped at 31 days, `422 DATE_RANGE_TOO_LARGE`), compute that day's working window(s) — the intersection of `BusinessHours` (salon-wide, closed days/holidays excluded entirely) and that employee's active `WorkingHours` entries for the matching `dayOfWeek` (their own overlapping windows are unioned, supporting split shifts), minus any day the employee is on `EmployeeTimeOff`. Within each window, candidate slots are generated at a fixed 15-minute granularity, each sized to the requested service's `durationMinutes`; a candidate is excluded if it overlaps any existing `isBlocking` `AppointmentService` range for that employee (the exact same overlap test the `EXCLUDE` constraint enforces at the database level: `candidateStart < existing.blockedUntil AND existing.startTime < candidateBlockedUntil`).

**Buffer composition rule** (`effectiveBufferMinutes`, the first real read of the dormant `TenantSettings.business` namespace): `max(service.bufferTimeMinutes, tenantSettings.business.bookingBufferMinutes)`, defaulting the tenant-wide value to `0` when unset. Applied as a **trailing-only** buffer, per employee-line — not once at the end of a multi-service visit. See docs/adr/ADR-009 for the full reasoning.

**Known, explicitly-flagged simplification**: `WorkingHours`/`BusinessHours` store wall-clock `"HH:mm"` strings with no timezone of their own, and every `DateTime` column is a plain, non-timezone-aware `TIMESTAMP`. Combining a wall-clock time with a calendar date is done via literal UTC construction (`"{date}T{time}:00.000Z"`, `common/utils/scheduling-date.util.ts`) — matching this codebase's existing "no explicit per-tenant-timezone conversion layer" posture (no earlier milestone's `WorkingHours`/`BusinessHours` consumption code does real per-`Tenant.timezone` math either) rather than introducing the only timezone-aware code path in the system. **Full per-tenant-timezone-correct scheduling remains an open, explicitly-deferred item** for a future pass — every date/time in this milestone's UI and API is UTC, not the salon's local time.

---

## 5. Appointment Lifecycle

`created` (`CONFIRMED` — every appointment this milestone creates goes straight to `CONFIRMED`; `PENDING` is reserved for a future AI-initiated flow, Milestone 8) → optionally **cancelled** (`POST .../cancel`, requires `PENDING`/`CONFIRMED`, else `409 INVALID_STATUS_TRANSITION`; a late-notice warning — never blocking, for any role — is included in the response when within `TenantSettings.business.cancellationNoticeHours` of `now()`, default 24h) → optionally **rescheduled** (`POST .../reschedule`, same status precondition; creates a linked new `Appointment`, marks the original `RESCHEDULED`, frees the original's lines). `DELETE /appointments/:id` is a separate, `OWNER`-only, `appointments:manage`-gated soft-delete reserved for genuine data-entry-error correction (a duplicate created before idempotency was in place) — never the correct path for a real customer cancellation, which must go through `.../cancel` to preserve the full audit trail (API_SPECIFICATION.md Section 10).

**STAFF scoping** (PROJECT_REQUIREMENTS.md Business Rule 11): a `STAFF` caller may only access an appointment where their linked `Employee` (`EmployeeService.findByUserId`) is either the primary `employeeId` or appears in any line — `403 FORBIDDEN`, never `404`, since the resource genuinely exists within the same tenant (API_SPECIFICATION.md Section 10's explicit rule). `GET /appointments` (list) applies a simpler version — forcing the `employeeId` filter to the caller's own linked employee — checking only the primary/denormalized field, a documented simplification for the list view; the per-line check on direct `:id` access remains the full, correct security boundary.

**Idempotency** (`core/idempotency/idempotency.interceptor.ts`, `IdempotencyInterceptor`): required on `POST /appointments`, `.../cancel`, `.../reschedule` (`400 IDEMPOTENCY_KEY_REQUIRED` if missing). Redis-backed, `idempotency:{tenantId}:{key}` → `{ requestHash, statusCode, body }`, 24h TTL. A retry with the identical payload replays the exact prior response (status code included, via direct Express `response.status()` — the response-transform interceptor still wraps it correctly since idempotency runs at the method level, inside the global envelope interceptor); the same key with a **different** payload is `409 IDEMPOTENCY_KEY_REUSED`. Built once, generically — reusable by any future booking-critical endpoint (docs/adr/ADR-009).

**Cursor pagination** (`common/utils/cursor-pagination.util.ts`): `GET /appointments` and `GET /customers` both use real keyset pagination (`(sortField, id)` tuple comparison expressed as the standard OR-expansion), per API_SPECIFICATION.md Section 2.4.1's standing rule for high-volume, actively-written resources. `GET /appointments` sorts only on `startTime` (per the spec); `GET /customers` on `firstName`/`createdAt` (default `-createdAt`). Query-string filters use flat parameter names (`status`, `employeeId`, `startTimeFrom`/`startTimeTo`) rather than the doc's generic `filter[field][op]` bracket notation — the same simplification `ListServicesQueryDto`/`ListEmployeesQueryDto` already made, since Express's default `qs` parser turns bracket syntax into nested objects, not literal bracket-named keys, and this endpoint's actual filter set doesn't need the general mechanism.

---

## 6. Endpoints Reference

Base path `/api/v1`. All controllers stack `JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard`; `TenantActiveGuard` is applied per mutating method only.

| Method | Path | Min Role | Permission | Notes |
|---|---|---|---|---|
| GET | `/customers` | STAFF | — | Cursor pagination; `q` searches first/last name/phone; `marketingOptIn` filter |
| GET | `/customers/:id` | STAFF | — | |
| POST | `/customers` | STAFF | — | `409 PHONE_NUMBER_ALREADY_EXISTS` (existing `customerId` in `details`) |
| PATCH | `/customers/:id` | STAFF | — | `phoneNumber` immutable via this endpoint |
| DELETE | `/customers/:id` | MANAGER | `customers:manage` | Soft delete |
| GET | `/appointments/availability` | STAFF | — | `serviceId` required, `employeeId` optional, `dateFrom`/`dateTo` (max 31 days) |
| GET | `/appointments` | STAFF | — | Cursor pagination, `sort=startTime` only; STAFF forced to own `employeeId` |
| GET | `/appointments/:id` | STAFF | — | STAFF: 403 if not their own (via any line) |
| POST | `/appointments` | STAFF | — | `Idempotency-Key` required; `services: [{serviceId, employeeId}]`; `409 SLOT_NO_LONGER_AVAILABLE` |
| PATCH | `/appointments/:id` | STAFF | — | `notes` only |
| DELETE | `/appointments/:id` | OWNER | `appointments:manage` | Soft delete, frees blocked lines |
| POST | `/appointments/:id/cancel` | STAFF | — | `Idempotency-Key` required |
| POST | `/appointments/:id/reschedule` | STAFF | — | `Idempotency-Key` required; `services` optional (omit = keep assignments) |

New RBAC permission keys `customers:manage`, `appointments:manage` (`backend/prisma/seed.ts`), granted to `OWNER`/`MANAGER` — gating only the sensitive delete path on each resource, not every write (§ADR-009).

---

## 7. Deferred / Known Gaps (Not Forgotten)

- **`AppointmentReminder`/BullMQ reminder scheduling** — not built. `backend/src/queues/` remains empty. Explicitly out of scope per this milestone's brief ("no notifications beyond scheduling").
- **`AppointmentFeedback`, `CustomerTag`/`CustomerNote`/`CustomerPreference`** — not built; not requested.
- **Per-tenant-timezone-correct scheduling** — every date/time is UTC-literal; `Tenant.timezone` is not consulted anywhere in the availability/booking path. Flagged in §4 as an open item, not an oversight.
- **`GET /appointments` STAFF scoping checks only the primary `employeeId`**, not every line — a documented simplification (§5); direct `:id` access is fully correct.
- **No frontend resource (per-employee-column) calendar view** — see docs/CALENDAR_ENGINE.md.

---

## 8. Files

**Backend, new:** `backend/src/modules/{customers,availability,appointments}/**`, `backend/src/core/locking/**`, `backend/src/core/idempotency/**`, `backend/src/common/utils/{cursor-pagination,json-settings,scheduling-date}.util.ts`, `backend/test/unit/{customers,availability,appointments,core}/**` (new specs), `backend/test/integration/{customers,appointments}/**`, `backend/test/integration/support/scheduling-fixtures.ts`.

**Backend, modified:** `backend/prisma/schema.prisma` (+`Customer`, `Appointment`, `AppointmentService`, `AppointmentStatusHistory` models, +`AppointmentStatus`/`AppointmentHistoryAction` enums, +`btree_gist` extension, +`Tenant`/`Employee`/`Service`/`User` back-relations), `backend/prisma/migrations/<timestamp>_milestone_6_scheduling_engine/` (+manual SQL for the partial unique index and `EXCLUDE` constraint), `backend/prisma/migrations/<timestamp>_fix_appointment_status_history_id_default/`, `backend/prisma/seed.ts` (+`customers:manage`/`appointments:manage`), `backend/src/app.module.ts` (+3 modules), `backend/src/modules/employees/{employees.module.ts,application/employee.service.ts}` (+exports, +`findByUserId`), `backend/src/modules/salon/salon.module.ts` (+exports), `backend/src/modules/tenants/tenants.module.ts` (+`TenantSettingsService` export), `backend/src/modules/tenants/infrastructure/prisma-tenant-settings.repository.ts` (race-condition fix).

**Frontend, new:** `frontend/src/app/features/{customers,appointments}/**`, `frontend/src/app/core/api/{customers-api,appointments-api}.service.ts`, `frontend/src/app/shared/models/{customer,appointment,availability}.model.ts`.

**Frontend, modified:** `frontend/src/app/app.routes.ts` (+4 routes), `frontend/src/app/layouts/dashboard-layout/dashboard-layout.html` (+"Customers"/"Appointments" nav links), `frontend/src/app/shared/constants/role-permissions.constant.ts` (+`customers:manage`/`appointments:manage`), `frontend/src/app/core/api/api-client.ts` (+`headers` option for `Idempotency-Key`).
