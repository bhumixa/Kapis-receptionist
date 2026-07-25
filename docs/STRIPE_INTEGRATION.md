# STRIPE_INTEGRATION.md

## Stripe Integration — Checkout, Customer Portal, and Webhook Processing

**Document Status:** As-Built
**Milestone:** 9 — Billing & Subscription Management
**Depends on:** docs/BILLING_ARCHITECTURE.md, API_SPECIFICATION.md §2.12/§2.13/§13, docs/WHATSAPP_ARCHITECTURE.md (webhook/queue pattern this mirrors)

---

## 1. Stripe Is the Only Payment Provider

No other payment provider is integrated or planned (`PROJECT_REQUIREMENTS.md` explicitly excludes this). The platform never stores raw card data — every payment-method interaction happens on Stripe-hosted pages (Checkout, Customer Portal), keeping PCI scope at zero.

---

## 2. `StripeClient` — the One File That Imports the SDK

`src/modules/billing/infrastructure/stripe-client.ts` is the only file in this module that imports the `stripe` npm package — mirrors `OpenAiLlmProvider`/`WhatsAppCloudApiClient`'s "one adapter, one import" convention. Every method is a thin, single-purpose wrapper:

| Method | Used by |
|---|---|
| `createCustomer` | `CheckoutService` (lazy, first Checkout only) |
| `createCheckoutSession` | `CheckoutService` |
| `createPortalSession` | `CustomerPortalService` |
| `changeSubscriptionPrice` | `SubscriptionsService.changePlan` (only if a live Stripe subscription exists) |
| `cancelAtPeriodEnd` / `resumeSubscription` | `SubscriptionsService.cancel`/`.reactivate` |
| `constructWebhookEvent` | `WebhookIngestionService` — the **only** method that makes no network call (pure HMAC verification against the raw body) |

`EntitlementService` and every read path (`GET /subscriptions`, `GET /invoices`) never call `StripeClient` at all — entitlement checks are pure DB reads, by design (see `docs/BILLING_ARCHITECTURE.md` §2.2.1).

### 2.1 Error handling

Every Stripe SDK call is wrapped (`StripeClient.wrap`) into a typed `StripeApiError` (`stripeType`, `isTransient` — mirrors `WhatsAppCloudApiError`'s retry-classification precedent: `StripeConnectionError`/`StripeAPIError`/`StripeRateLimitError` are transient, everything else is permanent). Every application-layer call site (`CheckoutService`, `CustomerPortalService`, `SubscriptionsService`) wraps its Stripe call with `callStripe()` (`application/exceptions/billing.exceptions.ts`), which catches `StripeApiError` and rethrows it as `StripeUnavailableException` — `503 UPSTREAM_UNAVAILABLE` (API_SPECIFICATION.md §2.3's global error-code table already reserves this for third-party outages), so a Stripe misconfiguration or outage never surfaces as an opaque, unclassified `500`. **Live-verified** against a real running backend with an intentionally invalid `STRIPE_SECRET_KEY`: `POST /subscriptions` correctly returned `503` with a clean, user-facing message ("Stripe is temporarily unavailable. Please try again in a moment.") instead of a raw `Internal Server Error`.

---

## 3. Checkout Flow

1. Tenant selects a plan on `/app/billing` → `POST /subscriptions` (`Idempotency-Key` required, `billing:manage` permission, `OWNER` only).
2. `CheckoutService.createCheckoutSession`:
   - Validates the plan (must exist and be active).
   - If `Subscription.stripeCustomerId` is `null`, creates a real Stripe Customer now (`actor.email`, tenant name) — the **only** place in this codebase a Stripe Customer is ever created, and the only place this endpoint touches the network for customer creation.
   - Resolves an optional coupon (validates active/not-expired/not-exhausted, increments `redemptionCount` optimistically).
   - Creates a Stripe Checkout Session (`mode: 'subscription'`) with `success_url`/`cancel_url` from config, `subscription_data.metadata.tenantId` and top-level `metadata.tenantId` (used by webhook tenant resolution as a defensive secondary signal; the primary resolution path is `stripeCustomerId` lookup — see §5).
3. Frontend redirects the browser to `session.url`.
4. Stripe collects payment details on its own hosted page; on success, fires `checkout.session.completed` and `customer.subscription.created` webhooks (§5) which is what actually activates the subscription locally — the Checkout Session response itself carries no subscription state.

---

## 4. Customer Portal Flow

`POST /subscriptions/portal-session` → `CustomerPortalService.createPortalSession` → requires `Subscription.stripeCustomerId` to already exist (`422 NO_STRIPE_SUBSCRIPTION` otherwise — a tenant who never started Checkout has nothing to manage). Returns a Stripe-hosted Billing Portal URL for payment-method updates and invoice downloads — this platform never builds its own card-entry or invoice-PDF UI.

---

## 5. Webhook Processing

Mirrors `docs/WHATSAPP_ARCHITECTURE.md` §4's exact flow — the same two-stage sync-ingest/async-process split, the same two-layer idempotency philosophy.

### 5.1 Ingestion (`POST /stripe/webhook`, `WebhookIngestionService.ingest`)

1. Verify via the Stripe SDK's own `stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)` — no hand-rolled HMAC (unlike WhatsApp/Meta, Stripe ships this natively).
2. **On verification failure:** persist a `WebhookLog` row anyway, with a synthetic always-unique `providerEventId` (`invalid-${randomUUID()}`) since the payload isn't trusted enough to extract Stripe's real event id — a spoofing attempt is forensic evidence, not noise to discard (same philosophy as WhatsApp's `signatureValid: false` rows). Throws `401 INVALID_STRIPE_WEBHOOK_SIGNATURE`.
3. **On verification success:**
   - Redis dedup: `SET NX EX` on `dedup:stripe:{event.id}`, 48h TTL. A hit (already seen) short-circuits with no DB write and no enqueue.
   - DB backstop: `findByProviderEventId('STRIPE', event.id)` — catches a cold/evicted Redis key.
   - Persists the full event as `WebhookLog` (`tenantId: null`, resolved asynchronously).
   - Enqueues `{ webhookLogId }` onto the `stripe-webhook` BullMQ queue (5 attempts, exponential backoff, 2s base — identical shape to `whatsapp-inbound`).
   - Returns a fast empty `200` — Stripe (like Meta) retries on timeout/non-2xx.

The route is unversioned/unprefixed (`main.ts`'s `/api/v1` prefix exclusion list, alongside `webhooks/whatsapp` and `health`) and exempt from the success-response envelope (`ResponseTransformInterceptor`) — Stripe expects a bare `200`, not this platform's JSON envelope.

### 5.2 Processing (`StripeEventProcessorService.process`, off the `stripe-webhook` queue)

Dispatches on `event.type`:

| Event type | Handler | Effect |
|---|---|---|
| `customer.subscription.{created,updated,deleted}` | `handleSubscriptionEvent` | Resolves tenant via `stripeCustomerId` → `SubscriptionsService.applyStripeSubscriptionEvent` (status mapping, period dates, plan resolution via `stripePriceId`, `Tenant.status` sync) |
| `invoice.{paid,payment_succeeded,finalized,payment_failed}` | `handleInvoiceEvent` | Upserts `Invoice` by `stripeInvoiceId` (idempotent); on `invoice.paid`, resets `messagesUsedCurrentPeriod` to 0 (new billing period) |
| `payment_intent.{succeeded,payment_failed}` | `handlePaymentIntentEvent` | Upserts `Payment` by `stripePaymentIntentId`, including `failureCode`/`failureMessage` for dunning visibility |
| anything else | — | Logged and ignored (not an error) |

**Tenant resolution** happens inside the async worker, never the controller — the same deliberate exception to `TenantContextService` being the sole resolver everywhere else that WhatsApp's inbound processor already established, since a webhook carries no JWT. For subscription events, resolution is via `stripeCustomerId`; if no local `Subscription` matches (an event for a customer this platform doesn't recognize), the event is logged and dropped — never processed against a guessed tenant.

Every handler is independently idempotent (upsert-by-Stripe-id or a `findByStripeCustomerId` resolve), so BullMQ's at-least-once redelivery on a transient failure is always safe to replay. A processing failure marks the `WebhookLog` row `FAILED` with the error message and rethrows (triggering BullMQ's retry).

---

## 6. Local Development

`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in `.env` are **placeholder strings**, not real Stripe credentials. This is sufficient for:
- Every unit test (`test/unit/billing/*.spec.ts`) — `StripeClient` is never invoked; mocks operate at the port/service boundary.
- Every integration test that exercises Checkout/Portal/plan-change/cancel/reactivate (`test/integration/billing/subscriptions.integration-spec.ts`) — `StripeClient` is swapped for `FakeStripeClient` (`test/integration/support/billing-fixtures.ts`) via `createTestApp`'s `overrideProviders` hook, mirroring the AI module's `ScriptedLlmProvider` precedent. No real Stripe API call is ever made in CI.
- Every webhook-ingestion/idempotency test (`test/integration/billing/stripe-webhook.integration-spec.ts`) — signature verification is a symmetric HMAC scheme, so signing a test payload with the same placeholder `STRIPE_WEBHOOK_SECRET` the running app was configured with produces a signature the real (unmocked) `StripeClient.constructWebhookEvent` accepts, fully offline (`test/integration/support/billing-fixtures.ts`'s `signStripePayload`).

**To exercise a real Stripe Checkout flow** (manual/exploratory testing, not CI): create a Stripe account, switch to test mode, create Products/Prices matching the seeded plan tiers, update each `Plan.stripePriceId` (via `prisma/seed.ts` or `PATCH /admin/plans/:id`), set real `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` in `.env`, and either register a webhook endpoint pointing at a publicly reachable `POST /stripe/webhook` or use the Stripe CLI's `stripe listen --forward-to localhost:3000/stripe/webhook` (which also prints a session-scoped `STRIPE_WEBHOOK_SECRET` to use locally). The Implementation Roadmap's own risk note calls out testing against Stripe's CLI-based webhook-replay tooling specifically, since event-ordering/idempotency edge cases (a `subscription.updated` arriving before/after its corresponding payment event) are a known source of late-discovered bugs — this codebase's idempotent-upsert-everywhere design is built to tolerate exactly that.
