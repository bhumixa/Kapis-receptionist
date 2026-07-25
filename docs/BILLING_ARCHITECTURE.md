# BILLING_ARCHITECTURE.md

## Billing & Subscription Management — Implementation Reference

**Document Status:** As-Built
**Milestone:** 9 — Billing & Subscription Management
**Depends on:** SYSTEM_ARCHITECTURE.md §3/§5(pattern precedent), DATABASE_DESIGN.md §3.8/§8/§10.7, PRISMA_SCHEMA.md §10, API_SPECIFICATION.md §13/§2.12/§2.13, docs/STRIPE_INTEGRATION.md, docs/FEATURE_ENTITLEMENTS.md, docs/adr/ADR-012-billing-and-subscriptions.md, docs/adr/ADR-010-whatsapp-platform.md (webhook/queue precedent), docs/TENANT_ARCHITECTURE.md
**Scope:** What Milestone 9 actually built — `modules/billing` (Plan/Subscription/Invoice/Payment/Coupon/WebhookLog, Stripe Checkout/Portal/webhook processing), the centralized `EntitlementService`, and the cross-module entitlement wiring into Employees/Appointments/WhatsApp. Analytics, marketing automation, payroll, accounting exports, CRM, and additional payment providers are explicitly out of scope.

---

## 1. What Exists Now

| Capability | Endpoint(s) | Module |
|---|---|---|
| Plan listing (public) | `GET /plans` | `modules/billing` |
| Subscription read/lifecycle | `GET/POST /subscriptions`, `POST /subscriptions/{change-plan,cancel,reactivate,portal-session}` | `modules/billing` |
| Invoice/payment history | `GET /invoices`, `GET /payments` | `modules/billing` |
| Stripe webhook ingestion | `POST /stripe/webhook` | `modules/billing` |
| Platform Admin plan management | `GET/PATCH /admin/plans[/:id]` | `modules/admin` (billing services) |
| Platform Admin tenant billing lookup | `GET /admin/tenants/:id/billing` | `modules/admin` (billing services) |
| Feature entitlement enforcement | in-process, no HTTP surface | `EntitlementService`, consumed by `modules/employees`, `modules/appointments`, `modules/whatsapp` |
| Frontend billing page | `/app/billing` | `features/billing` |
| Frontend admin billing pages | `/admin/plans`, `/admin/tenants/:id/billing` | `features/admin` |

---

## 2. Data Model

### 2.1 `Plan` — global reference data (pulled forward from Milestone 1)

```prisma
model Plan {
  id                       String   @id
  name                     String
  stripePriceId            String   @unique
  monthlyPriceCents        Int
  currency                 String   @default("USD")
  maxStaff                 Int?
  maxMessagesPerMonth      Int?
  maxLocations             Int      @default(1)
  maxAppointmentsPerMonth  Int?     // added Milestone 9
  maxStorageMb             Int?     // added Milestone 9, reserved — see Section 6
  isActive                 Boolean  @default(true)
  trialDays                Int      @default(14)
}
```

`null` on any `max*` field means unlimited. Retired plans are deactivated (`isActive: false`), never deleted — existing `Subscription.planId` FKs must stay valid (`onDelete: Restrict`). Seeded with three illustrative tiers (Starter/Professional/Business, `prisma/seed.ts`) using **placeholder** `stripePriceId` values — replace with real Stripe Price IDs (via the seed file or `PATCH /admin/plans/:id`) before accepting real payments.

### 2.2 `Subscription` — 1:1 with `Tenant`

```prisma
model Subscription {
  id                          String             @id
  tenantId                    String             @unique
  planId                      String
  stripeCustomerId            String?            // nullable — see 2.2.1
  stripeSubscriptionId        String?            @unique // null pre-Checkout
  status                      SubscriptionStatus @default(TRIALING)
  currentPeriodStart          DateTime?
  currentPeriodEnd            DateTime?
  cancelAtPeriodEnd           Boolean            @default(false)
  canceledAt                  DateTime?
  couponId                    String?
  messagesUsedCurrentPeriod   Int                @default(0)
  updatedByType                ActorType          @default(SYSTEM)
  updatedById                 String?
}
```

`status` is authoritatively driven by Stripe webhooks (`StripeEventProcessorService` via `SubscriptionsService.applyStripeSubscriptionEvent`) — application code elsewhere only reads it. This table is a **queryable mirror of Stripe's truth**, never a second source of it.

#### 2.2.1 Deliberate deviation: `stripeCustomerId` is nullable

`docs/DATABASE_DESIGN.md` §3.8.2 designs this column as required. As-built, it's nullable, and this is load-bearing for three things:

1. **Registration never calls Stripe.** `PrismaRegistrationRepository.registerTenantOwner` creates `Tenant + User + TenantSettings + Subscription` in one Postgres transaction (unchanged precedent from Milestone 3) — adding a network call to Stripe *inside* that transaction would be a correctness and latency hazard. The `Subscription` row is created with `stripeCustomerId: null`, `status: TRIALING`, against the cheapest active `Plan`.
2. **`EntitlementService`'s defensive backfill never calls Stripe.** Any tenant reaching an entitlement check without a `Subscription` row (seeded directly via Prisma, bypassing `POST /auth/register` — the exact shape every pre-Milestone-9 integration test's `seedOwner()` helper takes) is transparently upserted onto the cheapest active `Plan` in `TRIALING` status (`SubscriptionsService`/`SubscriptionRepositoryPort.upsertTrialForTenant`, mirroring `TenantSettingsService.getSettings`'s own upsert-based backfill precedent). This can run on any tenant-scoped write path (Employees, Appointments, WhatsApp inbound) — it must never depend on a live network call.
3. **No Stripe Customer object is created for trials that never convert.** Most trial signups never pay; creating a Stripe Customer for every one of them is unnecessary API surface and, more importantly, an unnecessary point of failure on the hot path (registration, every entitlement check). The real Stripe Customer is created **lazily, exactly once**, the first time a tenant starts Checkout (`CheckoutService.createCheckoutSession`).

### 2.3 `Invoice` / `Payment` — synced from Stripe webhooks only

Application code never creates these directly. `Invoice.invoicePdfUrl` is a bare Stripe-hosted URL string, not an FK to a `File` model — no Files/S3 module exists yet in this codebase (same placeholder-string precedent as `salon_profiles.logo_url`, Milestone 4). `Payment.invoiceId` is optional (`onDelete: SetNull`) since a payment attempt can exist before/without a finalized invoice in some Stripe flows.

### 2.4 `Coupon` — global

Mirrors a Stripe Coupon. `redemptionCount` is incremented **optimistically at Checkout-session-creation time**, not on confirmed payment — a documented simplification (an abandoned Checkout session over-counts by one) rather than parsing Stripe's discount data back out of `checkout.session.completed`.

### 2.5 `WebhookLog` — the Stripe analogue of WhatsApp's `WebhookEvent`

Deliberately a separate model, not a shared/polymorphic table with WhatsApp's `WebhookEvent` — the two providers have different processing pipelines, signature schemes, and consumers; conflating them would force nullable provider-specific columns onto every row. `id` uses standard `gen_random_uuid()`, not the app-generated UUIDv7 `docs/PRISMA_SCHEMA.md` §10 recommends — mirrors the `AuditLog`/`AppointmentStatusHistory` precedent ("not worth a new dependency at this milestone's volume," a deferred follow-up, not an oversight). `@@unique([provider, providerEventId])` is Stripe's own idempotency key.

---

## 3. Module Layout

`src/modules/billing/` — a single Clean Architecture module (not split into `Plans`/`Subscriptions`/`Invoices` NestJS modules), the same "one module, layered per aggregate internally" precedent WhatsApp and AI established:

```
domain/
  entities/           plan, subscription, invoice, payment, coupon, webhook-log
  ports/              *-repository.port.ts (interface + DI token per aggregate)
application/
  plans.service.ts
  subscriptions.service.ts
  checkout.service.ts
  customer-portal.service.ts
  invoices.service.ts
  entitlement.service.ts         # the centralized gate — see FEATURE_ENTITLEMENTS.md
  usage-tracking.service.ts      # billing-period counter rollover
  webhook-ingestion.service.ts   # sync: verify + persist + enqueue
  stripe-event-processor.service.ts  # async: the real webhook business logic
  exceptions/billing.exceptions.ts
infrastructure/
  prisma-*.repository.ts
  mappers/prisma-billing.mappers.ts
  stripe-client.ts               # the only file importing the `stripe` package
interface/
  plans.controller.ts, subscriptions.controller.ts, invoices.controller.ts,
  webhooks.controller.ts
  dto/, mappers/billing-response.mapper.ts
queues/
  billing-queue.constants.ts, billing-queue.module.ts, stripe-webhook.processor.ts
billing.module.ts
```

`BillingModule` imports `CoreModule`, `AuthModule`, `IdempotencyModule`, `TenantsModule` (for `TenantLifecycleService.syncStatusFromBilling` and `TenantService.getProfile`/`getProfileForAdmin`), and `BillingQueueModule`. It exports `EntitlementService`, `UsageTrackingService`, `PlansService`, `SubscriptionsService`, `InvoicesService` — consumed one-directionally by `EmployeesModule`, `AppointmentsModule`, `WhatsAppModule`, and `AdminModule`. **No `forwardRef` is needed for any of these edges** (see §5).

---

## 4. Subscription Lifecycle & Grace-Period Policy

Resolves `PROJECT_REQUIREMENTS.md` §22 Q9 ("what happens to in-flight AI conversations when a subscription lapses"), decided during this milestone's approval step: **grace period, not immediate cutoff.**

| Stripe `subscription.status` | Local `SubscriptionStatus` | `Tenant.status` | Mutating routes blocked? |
|---|---|---|---|
| `trialing` | `TRIALING` | `TRIAL` | No |
| `active` | `ACTIVE` | `ACTIVE` | No |
| `past_due` | `PAST_DUE` | `PAST_DUE` | **No** — degraded but functional, persistent dashboard banner |
| `canceled` | `CANCELED` | `CANCELLED` | Yes |
| `unpaid` | `UNPAID` | `SUSPENDED` | Yes — Stripe's own dunning retries are exhausted |
| `incomplete`/`incomplete_expired` | `INCOMPLETE`/`CANCELED` | unchanged / `CANCELLED` | `incomplete` doesn't sync `Tenant.status` (transient, initial payment still processing) |

`TenantActiveGuard` (backend, unchanged since its Milestone 3 structural skeleton) and `tenantActiveGuard` (frontend) both only block `SUSPENDED`/`CANCELLED` — `PAST_DUE` was already a no-op for both, this milestone just gave it a real driving signal (`SubscriptionsService.applyStripeSubscriptionEvent` → `TenantLifecycleService.syncStatusFromBilling`).

**Cancellation timing** (this milestone's approved decision): if a live Stripe subscription exists, cancel schedules `cancel_at_period_end: true` on Stripe and mirrors it locally — access continues until the period ends. If no live Stripe subscription exists yet (still trial-only, no money ever changed hands), cancellation is immediate and final (`status: CANCELED`, `Tenant.status: CANCELLED`) — there's nothing to bill out.

**Plan changes** (this milestone's approved decision): both upgrade and downgrade apply **immediately with Stripe proration** — one code path (`SubscriptionsService.changePlan`), not a scheduled-downgrade mechanism.

---

## 5. Why No `forwardRef` Is Needed (Contrast with AI↔WhatsApp)

`EntitlementService.assertWithinLimit(tenantId, feature, currentUsage)` takes `currentUsage` as a plain parameter — the caller (Employees/Appointments) computes it from **its own repository** before calling in. `EntitlementService` itself only ever reads `Subscription`/`Plan` (its own module's data). This is what keeps `BillingModule` from needing a circular dependency on every module it gates, in contrast to the genuine, necessary `AiModule`↔`WhatsAppModule` cycle (`docs/adr/ADR-011-ai-receptionist.md`) where AI needs to call back into WhatsApp's `ConversationsService` and vice versa.

Concretely:
- `EmployeesModule` imports `BillingModule` → `EmployeeService.createEmployee` calls `this.employees.countActiveForTenant(tenantId)` (its own repository), then `entitlements.assertWithinLimit(tenantId, EMPLOYEE_LIMIT, count)`.
- `AppointmentsModule` imports `BillingModule` → `AppointmentsService` counts non-cancelled appointments in the current **calendar month** (a deliberate simplification — not the tenant's exact Stripe billing period, to avoid `Appointments` needing any dependency on `Subscription`'s period fields) via its own repository, then asserts.
- `WhatsAppModule` imports `BillingModule` → `InboundMessageProcessorService.triggerAiResponse` calls `entitlements.checkAndIncrementAiMessageUsage(tenantId)` before invoking the AI orchestrator — this one *does* read+increment `Subscription.messagesUsedCurrentPeriod` directly, since that's Billing's own data.

None of these edges require `BillingModule` to import `EmployeesModule`/`AppointmentsModule`/`WhatsAppModule` back.

---

## 6. Deferred / Known Gaps (Not Forgotten)

- **`Plan.maxStorageMb` is carried but not enforced.** No Files/S3 module exists yet in this codebase to meter real usage against it — the column is reserved for when that module ships, matching this codebase's "narrow the ask, log the deferral" convention.
- **`POST /ai/chat`'s sandbox/QA endpoint is not entitlement-gated.** Only the real production WhatsApp inbound path is (`InboundMessageProcessorService`) — the dashboard "Test my AI" sandbox already has its own separate per-minute `AiRateLimitGuard` and is not customer-facing production traffic.
- **Coupon redemption counting is optimistic**, not confirmed-payment-based (§2.4).
- **`UsageTrackingService.resetPeriodUsage` fires on `invoice.paid`** — a tenant that never completes Checkout (stays on `TRIALING` forever) never gets a period reset; `messagesUsedCurrentPeriod` simply accumulates against the trial `Plan`'s limit, which is the correct behavior (a perpetual trial should still be capped).
- **No multi-location billing** — `Plan.maxLocations` is carried (inherited from the pre-Milestone-9 schema) but no `Location` concept exists in this codebase; out of MVP scope per `PROJECT_REQUIREMENTS.md` §11.

---

## 7. Environment Variables

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-to-server Stripe API authentication |
| `STRIPE_WEBHOOK_SECRET` | `Stripe-Signature` header verification (`stripe.webhooks.constructEvent`) |
| `STRIPE_PUBLISHABLE_KEY` | Reserved for a future client-side Stripe.js flow — not currently used server-side (Checkout/Portal are fully redirect-based) |
| `BILLING_CHECKOUT_SUCCESS_URL` / `BILLING_CHECKOUT_CANCEL_URL` | Stripe Checkout Session redirect targets |
| `BILLING_PORTAL_RETURN_URL` | Stripe Customer Portal return target |

See `docs/STRIPE_INTEGRATION.md` for the full webhook/signature mechanism and local-dev setup.

---

## 8. Files

**Backend — new:** `src/modules/billing/**` (full module, ~35 files); `test/unit/billing/*.spec.ts` (5 files, 34 tests); `test/integration/billing/*.integration-spec.ts` (4 files, 20 tests); `test/integration/support/billing-fixtures.ts`.

**Backend — modified:** `prisma/schema.prisma` (new enums/models, `Plan`/`Tenant` back-relations); `prisma/seed.ts` (3 plan tiers); `src/config/{configuration,env.validation,config.module}.ts`; `src/app.module.ts`; `src/main.ts` (raw-body/prefix exclusion for `/stripe/webhook`); `src/common/interceptors/response-transform.interceptor.ts` (same exclusion); `src/modules/auth/infrastructure/prisma-registration.repository.ts` (atomic trial `Subscription` creation); `src/modules/tenants/{application/tenant.service,application/tenant-lifecycle.service,domain/ports/tenant-repository.port}.ts` (`getProfileForAdmin`, `syncStatusFromBilling`); `src/modules/employees/{domain/ports/employee-repository.port,infrastructure/prisma-employee.repository,application/employee.service}.ts`; `src/modules/appointments/{domain/ports/appointment-repository.port,infrastructure/prisma-appointment.repository,application/appointments.service}.ts`; `src/modules/whatsapp/{whatsapp.module,application/inbound-message-processor.service}.ts`; `src/modules/admin/{admin.module,interface/admin-billing.controller.ts (new)}`; `.env`/`.env.example`.

**Frontend — new:** `src/app/shared/models/billing.model.ts`; `src/app/core/api/billing-api.service.ts`; `src/app/features/billing/pages/billing-page/**`; `src/app/features/admin/pages/{admin-plans-page,admin-tenant-billing-page}/**`; `src/app/core/guards/tenant-active.guard.spec.ts`.

**Frontend — modified:** `src/app/core/api/admin-api.service.ts` (plan management + tenant billing lookup); `src/app/core/guards/tenant-active.guard.ts` (redirect target now `/app/billing`); `src/app/app.routes.ts`; `src/app/layouts/{dashboard-layout,admin-layout}/**`; `src/app/features/admin/pages/admin-tenants-page/**` ("Billing" link).

**Frontend — removed:** `src/app/features/dashboard-home/pages/tenant-suspended-page/**` (superseded by `/app/billing`, per that component's own doc comment).
