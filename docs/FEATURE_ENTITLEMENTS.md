# FEATURE_ENTITLEMENTS.md

## Feature Entitlements — Centralized Plan Enforcement

**Document Status:** As-Built
**Milestone:** 9 — Billing & Subscription Management
**Depends on:** docs/BILLING_ARCHITECTURE.md, docs/TENANT_ARCHITECTURE.md, PROJECT_REQUIREMENTS.md (feature-gating requirements)

---

## 1. The Rule

No module checks `Plan.name`, `Plan.maxStaff`, or any other plan field directly. Every feature-gated decision goes through one class: `EntitlementService` (`backend/src/modules/billing/application/entitlement.service.ts`), exported by `BillingModule`. This is a hard constraint from the milestone spec, not a style preference — it's what lets a plan's limits change (via `PATCH /admin/plans/:id`) without touching a single line of Employee/Appointment/WhatsApp code.

---

## 2. `EntitlementService` API

```typescript
enum EntitlementFeature {
  EMPLOYEE_LIMIT,
  APPOINTMENT_LIMIT,
  AI_MESSAGE_LIMIT,
  STORAGE,
}

class EntitlementService {
  getOrCreateForTenant(tenantId: string): Promise<UsageSummary>; // { subscription, plan }
  assertWithinLimit(tenantId: string, feature: EntitlementFeature, currentUsage: number): Promise<void>; // throws PlanLimitExceededException
  checkAndIncrementAiMessageUsage(tenantId: string): Promise<void>; // throws PlanLimitExceededException
}
```

### 2.1 Why the caller computes `currentUsage`

`assertWithinLimit` takes usage as a parameter instead of querying it itself. `EntitlementService` lives in `BillingModule`; if it reached into `EmployeeRepository` or `AppointmentRepository` to count rows itself, `BillingModule` would depend on `EmployeesModule` and `AppointmentsModule` — and since both of those already depend on `BillingModule` (to call `assertWithinLimit` in the first place), that's a circular module graph. NestJS *can* resolve cycles with `forwardRef()` (as AI↔WhatsApp genuinely needs, since conversation turns flow both directions — see `docs/AI_ARCHITECTURE.md` §6), but this isn't that kind of cycle: billing doesn't need to *read* employee or appointment data, it only needs a number. Pushing the count to the call site keeps the dependency graph a strict DAG (`Employees/Appointments/WhatsApp → Billing`, never the reverse) and keeps `EntitlementService` a pure, easily-unit-tested function of `(tenantId, feature, usage) → void | throw`.

### 2.2 `checkAndIncrementAiMessageUsage` is the one exception

AI/WhatsApp message quota is check-and-increment in a single call (not check-then-separately-increment) because message volume is high-frequency and the increment itself *is* the usage record — there's no separate "AI message" table to count rows from the way Employees/Appointments have real tables. It atomically increments `Subscription.messagesUsedCurrentPeriod` and compares against `Plan.maxMessagesPerMonth`, throwing `PlanLimitExceededException` if the increment would exceed the cap (the increment is not applied on overflow — a rejected message doesn't consume quota).

---

## 3. The Four Gates, and Their Call Sites

| Feature | Plan field | Call site | Usage source |
|---|---|---|---|
| `EMPLOYEE_LIMIT` | `Plan.maxStaff` | `EmployeeService.create` (`src/modules/employees/application/employee.service.ts`) | `EmployeeRepositoryPort.countActiveForTenant(tenantId)` |
| `APPOINTMENT_LIMIT` | `Plan.maxAppointmentsPerMonth` | `AppointmentsService.createAppointment` / `.createAppointmentForAi` (`src/modules/appointments/application/appointments.service.ts`, private `assertWithinAppointmentLimit` helper) | `AppointmentRepositoryPort.countForTenantInRange(tenantId, monthStart, monthEnd)` — calendar-month boundaries, excludes `CANCELLED` |
| `AI_MESSAGE_LIMIT` | `Plan.maxMessagesPerMonth` | `InboundMessageProcessorService.triggerAiResponse` (`src/modules/whatsapp/application/inbound-message-processor.service.ts`) | none — `checkAndIncrementAiMessageUsage` is self-contained (§2.2) |
| `STORAGE` | `Plan.maxStorageMb` | *(not yet wired to a call site — no file-upload feature exists yet in this codebase)* | — |

A `null` limit on the `Plan` row means unlimited (the Business tier's `maxStaff: null`, `maxAppointmentsPerMonth: null`) — `assertWithinLimit` treats `null` as an automatic pass, never a "0 = blocked" footgun.

### 3.1 What happens on limit breach

- **Employees / Appointments** (synchronous, user-initiated write): the create call throws `PlanLimitExceededException` → mapped to `403 PLAN_LIMIT_EXCEEDED` at the controller boundary (global exception filter), same shape as every other domain exception in this codebase. The frontend surfaces this as a clear inline error, not a generic failure toast.
- **AI messages** (asynchronous, BullMQ-driven, no direct caller to return an HTTP error to): `InboundMessageProcessorService` catches `PlanLimitExceededException` specifically and logs+skips — the WhatsApp message is left unanswered by AI rather than crashing the queue job or retrying forever. This is a deliberate, narrower catch than a blanket try/catch around the whole handler: only the entitlement exception is swallowed; any other error still propagates to BullMQ's normal retry/failure handling.

---

## 4. Defensive Backfill

`getOrCreateForTenant` is called at the top of `assertWithinLimit`, `checkAndIncrementAiMessageUsage`, and every billing read endpoint. It's the single place a tenant that somehow has no `Subscription` row gets one — defensive, not a normal path, since registration (`PrismaRegistrationRepository`) already creates a `TRIALING` subscription against the cheapest active plan as part of the same transaction. It exists mainly for pre-Milestone-9 test fixtures (`seedOwner()`) and any future direct-DB-insert tooling that bypasses registration.

This backfill runs on nearly every tenant-scoped write path across the app (any create under Employees/Appointments touches it), so it had to be safe under concurrency: a naive check-then-create allowed two simultaneous requests for the same brand-new tenant to both see "no Subscription" and both attempt to create one, and the loser hit a unique-constraint violation instead of gracefully finding the winner's row. Fixed via `SubscriptionRepositoryPort.upsertTrialForTenant()` — an atomic Prisma `upsert` (`update: {}` no-op on conflict), the same pattern `TenantSettingsService`/`PrismaTenantSettingsRepository.createDefault` already established for tenant-settings backfill — with a `P2002` catch-and-refetch as defense-in-depth for the sub-millisecond window Prisma's upsert itself doesn't fully close under every database engine. Covered by `test/integration/billing/entitlement-enforcement.integration-spec.ts` and the pre-existing `appointments-concurrency.integration-spec.ts` (which is what caught the original race — see commit history / BILLING_ARCHITECTURE.md's problem-solving notes).

---

## 5. Adding a New Gated Feature (for future milestones)

1. Add the limit column to `Plan` (nullable = unlimited).
2. Add a variant to `EntitlementFeature`.
3. Add a case to `EntitlementService.assertWithinLimit`'s internal switch, comparing `currentUsage` against the new `Plan` field.
4. At the feature's own call site, compute `currentUsage` from that module's own repository (never from Billing) and call `assertWithinLimit`.
5. Import `BillingModule` in that feature's module (one-directional dependency — never the reverse).

No other module should ever import `PlanRepositoryPort` or `SubscriptionRepositoryPort` directly — only `BillingModule`'s own services do.
