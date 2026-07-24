# CALENDAR_ENGINE.md

## Appointments Calendar (Frontend) — Implementation Reference

**Document Status:** As-Built
**Milestone:** 6 — Appointment & Scheduling Engine
**Depends on:** docs/SCHEDULING_ARCHITECTURE.md, docs/FRONTEND_ARCHITECTURE.md, docs/adr/ADR-009-scheduling-engine.md
**Scope:** `AppointmentsCalendarPage` (`/app/appointments`) — Day/Week views, drag-and-drop rescheduling — plus its companion pages, `AppointmentFormPage` (`/app/appointments/new`) and `AppointmentDetailPage` (`/app/appointments/:id`).

---

## 1. Design: Day Columns, Not Employee Columns

The calendar renders **one column per calendar day** in both Day (1 column) and Week (7 columns, Sunday-start) view — not one column per employee. Each employee is distinguished on a card by a colored dot (reusing `Employee.colorTag`, the same visual convention `EmployeesListPage` already established) and a name label, not a separate resource lane.

**Why, not a true resource (day × employee) grid:** a two-dimensional grid is materially more implementation surface — column width negotiation across a variable employee count, empty-lane handling, horizontal scroll on top of the existing vertical one — for a first pass, and the milestone's brief asks for "Day / Week views" and "drag & drop rescheduling," not a resource view specifically. Within each day column, appointments are rendered as a simple time-ordered list of cards (start time, customer name, employee name + color dot, status) rather than pixel-positioned on a time axis — correctness (right order, right day) over a calendar-grid visual affordance that would need real vertical time-scale math (and per-tenant timezone correctness, still an open item per docs/SCHEDULING_ARCHITECTURE.md §4) to be trustworthy.

**Consequence, honestly stated:** a busy day with many employees working in parallel is harder to scan at a glance than a true resource grid would make it — this is the direct tradeoff of the simpler design, not a hidden limitation. A future pass building an actual per-employee lane view should treat this file's `dayColumns` computation as the reusable date-range/grouping logic and only replace the rendering layer.

## 2. Data Flow

`AppointmentsCalendarPage` holds `viewMode` (`'day' | 'week'`) and `anchorDate` as signals; `rangeStart`/`rangeEnd`/`dayColumns` are `computed()` from them. Navigation (Prev/Next/Today, Day/Week toggle) mutates `anchorDate`/`viewMode` and re-fetches — `AppointmentsApiService.listAppointments({ startTimeFrom, startTimeTo })` (a single generous-limit fetch, `limit: 100`, no pagination UI — the same precedent `EmployeesApiService`/`ServicesApiService` already established for bounded lists; a date-range-scoped calendar query naturally stays small). `EmployeesApiService.listEmployees()` is fetched once at construction for the color/name lookup; `Customer` records referenced by fetched appointments are lazily resolved one-by-one via `CustomersApiService.getCustomer()` and cached in a signal-backed map, since the appointment list response only carries `customerId`.

All date/time arithmetic is UTC-literal (`Date.UTC(...)`, `getUTCDay()`, `.toISOString()`) — consistent with docs/SCHEDULING_ARCHITECTURE.md §4's documented backend simplification; the calendar makes no attempt to convert to the salon's local time.

## 3. Drag-and-Drop

Native HTML5 drag-and-drop (`draggable`, `dragstart`/`dragend`/`dragover`/`drop`) — no library dependency, consistent with this project's stated preference against introducing shared/aspirational infrastructure before it's genuinely needed more than once. Dragging a card and dropping it on a **different day column** calls `AppointmentsApiService.rescheduleAppointment(id, { newStartTime })`, computing the new instant as `{targetDateKey}T{original time-of-day}` — the date changes, the time-of-day is preserved exactly. Dropping on the same day is a no-op. A card for a `CANCELLED`/`RESCHEDULED`/`COMPLETED`/`NO_SHOW` appointment cannot be dragged into producing a reschedule call (the same `PENDING`/`CONFIRMED`-only precondition the backend enforces is checked client-side first, so a doomed request is never sent).

**What drag-and-drop does not do:** reassign employees, or move a multi-service appointment's individual lines independently of each other — it is exactly a date shift of the whole appointment, reusing whichever service/employee assignments the appointment already has (the backend's `reschedule` endpoint's own "omit `services` to keep current assignments" behavior, docs/SCHEDULING_ARCHITECTURE.md §5). Reassigning employees or changing time-of-day requires the detail page's explicit reschedule form (`AppointmentDetailPage`).

**Failure handling:** if the drop's `reschedule` call fails (most likely `409 SLOT_NO_LONGER_AVAILABLE` — the target day/time is no longer free for that employee), the calendar simply reloads the current range from the server rather than trying to reconcile local state — the server's state is always the correct state to display, and a failed drag silently reverting via a full reload is simpler and more trustworthy than attempting an optimistic-update rollback.

## 4. Booking Form (`AppointmentFormPage`)

Customer selection is search-as-you-type (debounced 300ms) against `GET /customers?q=`, rendering a clickable results list; no inline "create customer" shortcut from this form — a salon owner adds a new walk-in customer via `/app/customers` first, consistent with keeping this form's scope to booking, not customer management. Service lines are a `FormArray`, each row independently selecting a service and — once a service is chosen — the set of employees eligible for *that specific service* (`GET /employees?serviceId=`, a parameter `EmployeesApiService` already supported before this milestone), directly reflecting the per-service employee assignment decision (docs/adr/ADR-009). An optional "Suggest times" action calls `GET /appointments/availability` for the first line's service/employee and date, rendering clickable slot buttons that set both the time field and that line's employee — a convenience, not a requirement; a user may type a time directly without ever calling availability, since the server always re-validates at submission regardless (API_SPECIFICATION.md Section 10's "never trust a prior GET" rule).

## 5. Files

**New:** `frontend/src/app/features/appointments/pages/{appointments-calendar-page,appointment-form-page,appointment-detail-page}/**`, `frontend/src/app/features/customers/pages/customers-list-page/**`, `frontend/src/app/core/api/{appointments-api,customers-api}.service.ts`, `frontend/src/app/shared/models/{appointment,availability,customer}.model.ts`.

**Modified:** `frontend/src/app/app.routes.ts`, `frontend/src/app/layouts/dashboard-layout/dashboard-layout.html`, `frontend/src/app/shared/constants/role-permissions.constant.ts`, `frontend/src/app/core/api/api-client.ts` (`headers` option, for `Idempotency-Key`), `frontend/src/app/core/api/employees-api.service.ts` (no changes needed — its existing `serviceId` filter parameter was already sufficient).
