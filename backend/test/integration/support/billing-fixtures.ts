import { createHmac } from 'node:crypto';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  CreateCheckoutSessionParams,
  CreatePortalSessionParams,
} from '../../../src/modules/billing/infrastructure/stripe-client';

/**
 * A scriptable `StripeClient` test double (mirrors `ScriptedLlmProvider`,
 * `ai-fixtures.ts`) — integration tests that exercise Checkout/Portal/
 * plan-change/cancel/reactivate substitute this for the real `StripeClient`
 * (via `createTestApp`'s `overrideProviders`) so no real Stripe API call is
 * ever made. `calls` records every method invocation so a spec can assert
 * on exactly what this platform sent Stripe. Webhook-ingestion specs do
 * *not* need this — `constructWebhookEvent` makes no network call (it's a
 * pure HMAC verification against the raw body), so those specs use the
 * real `StripeClient` unmodified.
 */
export class FakeStripeClient {
  readonly calls: {
    createCustomer: Array<{ email: string; name: string }>;
    createCheckoutSession: CreateCheckoutSessionParams[];
    createPortalSession: CreatePortalSessionParams[];
    changeSubscriptionPrice: Array<{ subscriptionId: string; priceId: string }>;
    cancelAtPeriodEnd: string[];
    resumeSubscription: string[];
  } = {
    createCustomer: [],
    createCheckoutSession: [],
    createPortalSession: [],
    changeSubscriptionPrice: [],
    cancelAtPeriodEnd: [],
    resumeSubscription: [],
  };

  createCustomer(email: string, name: string): Promise<string> {
    this.calls.createCustomer.push({ email, name });
    return Promise.resolve(
      `cus_fake_${Math.random().toString(36).slice(2, 10)}`,
    );
  }

  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<{ id: string; url: string | null }> {
    this.calls.createCheckoutSession.push(params);
    return Promise.resolve({
      id: `cs_fake_${Date.now()}`,
      url: 'https://stripe.test/checkout',
    });
  }

  createPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<{ url: string }> {
    this.calls.createPortalSession.push(params);
    return Promise.resolve({ url: 'https://stripe.test/portal' });
  }

  changeSubscriptionPrice(
    subscriptionId: string,
    priceId: string,
  ): Promise<void> {
    this.calls.changeSubscriptionPrice.push({ subscriptionId, priceId });
    return Promise.resolve();
  }

  cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    this.calls.cancelAtPeriodEnd.push(subscriptionId);
    return Promise.resolve();
  }

  resumeSubscription(subscriptionId: string): Promise<void> {
    this.calls.resumeSubscription.push(subscriptionId);
    return Promise.resolve();
  }

  reset(): void {
    this.calls.createCustomer = [];
    this.calls.createCheckoutSession = [];
    this.calls.createPortalSession = [];
    this.calls.changeSubscriptionPrice = [];
    this.calls.cancelAtPeriodEnd = [];
    this.calls.resumeSubscription = [];
  }
}

/**
 * Seeds a `Plan` directly via Prisma with a unique `stripePriceId` per call
 * (collision-safe across parallel `it`s, same convention as
 * `uniqueTestEmail`) — these integration specs test entitlement/webhook/
 * lifecycle behavior against known limits, not the seed data shipped by
 * `prisma/seed.ts`.
 */
export async function seedPlan(
  prisma: PrismaService,
  overrides: {
    name?: string;
    monthlyPriceCents?: number;
    maxStaff?: number | null;
    maxMessagesPerMonth?: number | null;
    maxAppointmentsPerMonth?: number | null;
    isActive?: boolean;
    trialDays?: number;
  } = {},
): Promise<{ id: string; stripePriceId: string }> {
  const stripePriceId = `price_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const plan = await prisma.plan.create({
    data: {
      name: overrides.name ?? 'Test Plan',
      stripePriceId,
      monthlyPriceCents: overrides.monthlyPriceCents ?? 4900,
      maxStaff: overrides.maxStaff ?? 5,
      maxMessagesPerMonth: overrides.maxMessagesPerMonth ?? 1000,
      maxAppointmentsPerMonth: overrides.maxAppointmentsPerMonth ?? 500,
      isActive: overrides.isActive ?? true,
      trialDays: overrides.trialDays ?? 14,
    },
  });
  return { id: plan.id, stripePriceId: plan.stripePriceId };
}

/**
 * `Plan` is global reference data, not tenant-owned — `cleanupTenant`'s
 * cascade-on-Tenant-delete never touches it. Every spec that calls
 * `seedPlan` MUST call this in its `finally`/`afterEach`, or the row
 * (and it's visible on the real, shared dev database's `GET /plans` —
 * discovered live, not hypothetically) outlives the test run. Deletes any
 * `Subscription` still pointing at the plan first (`onDelete: Restrict`
 * would otherwise reject the delete) — safe here because these are
 * always other fixture-created, already-`cleanupTenant`-orphaned test rows.
 */
export async function cleanupPlan(
  prisma: PrismaService,
  planId: string,
): Promise<void> {
  await prisma.subscription.deleteMany({ where: { planId } });
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {
    // Already gone — fine.
  });
}

/**
 * Signs a raw Stripe webhook payload exactly the way the real Stripe SDK's
 * `stripe.webhooks.constructEvent` verifies it (`t=<unix-seconds>,
 * v1=<hmac-sha256(secret, "<timestamp>.<payload>")>`) — a symmetric HMAC
 * scheme, so this works fully offline against the placeholder
 * `STRIPE_WEBHOOK_SECRET` in `.env`, no real Stripe account needed.
 */
export function signStripePayload(secret: string, payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Overwrites the `Subscription` row `POST /auth/register` already created
 * for this tenant (every tenant gets one atomically at registration,
 * Milestone 9) with test-specific plan/status/Stripe-id values — an
 * `upsert` rather than `create`, since the row already exists.
 */
export async function seedSubscription(
  prisma: PrismaService,
  tenantId: string,
  overrides: {
    planId: string;
    status?: SubscriptionStatus;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    messagesUsedCurrentPeriod?: number;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<{ id: string }> {
  const data = {
    planId: overrides.planId,
    status: overrides.status ?? SubscriptionStatus.TRIALING,
    stripeCustomerId: overrides.stripeCustomerId ?? null,
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    messagesUsedCurrentPeriod: overrides.messagesUsedCurrentPeriod ?? 0,
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
  };
  const subscription = await prisma.subscription.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return { id: subscription.id };
}
