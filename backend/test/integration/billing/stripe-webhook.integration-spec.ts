import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';
import {
  cleanupPlan,
  seedPlan,
  seedSubscription,
  signStripePayload,
} from '../support/billing-fixtures';
import { waitFor } from '../support/whatsapp-fixtures';

function subscriptionEventPayload(params: {
  eventId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  stripePriceId: string;
}) {
  return {
    id: params.eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: params.stripeSubscriptionId,
        customer: params.stripeCustomerId,
        status: params.status,
        cancel_at_period_end: false,
        canceled_at: null,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: { data: [{ price: { id: params.stripePriceId } }] },
      },
    },
  };
}

function invoicePaidEventPayload(params: {
  eventId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
}) {
  return {
    id: params.eventId,
    type: 'invoice.paid',
    data: {
      object: {
        id: params.stripeInvoiceId,
        customer: params.stripeCustomerId,
        status: 'paid',
        amount_due: 4900,
        amount_paid: 4900,
        currency: 'usd',
        created: Math.floor(Date.now() / 1000),
        due_date: null,
        invoice_pdf: 'https://stripe.test/invoice.pdf',
      },
    },
  };
}

describe('POST /stripe/webhook (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let webhookSecret: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
    expect(webhookSecret).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a POST with a missing/invalid signature and still logs the raw event', async () => {
    const payload = { id: 'evt_bad', type: 'ping' };
    const rawBody = JSON.stringify(payload);

    await request(app.getHttpServer())
      .post('/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=not-a-valid-signature')
      .send(payload)
      .expect(401);

    const event = await waitFor(() =>
      prisma.webhookLog.findFirst({
        where: { provider: 'STRIPE', eventType: 'unknown' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(event?.providerEventId).toMatch(/^invalid-/);
    void rawBody;
  });

  it('processes a customer.subscription.updated event and syncs local Subscription + Tenant status', async () => {
    const owner = await seedOwner(app, 'stripe-webhook-sub');
    let planId: string | undefined;
    try {
      const plan = await seedPlan(prisma, { name: 'Webhook Plan' });
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: plan.id,
        stripeCustomerId: 'cus_webhook_test',
        stripeSubscriptionId: null,
      });

      const eventId = `evt_${randomUUID()}`;
      const payload = subscriptionEventPayload({
        eventId,
        stripeSubscriptionId: 'sub_webhook_test',
        stripeCustomerId: 'cus_webhook_test',
        status: 'past_due',
        stripePriceId: plan.stripePriceId,
      });
      const rawBody = JSON.stringify(payload);

      await request(app.getHttpServer())
        .post('/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripePayload(webhookSecret, rawBody))
        .send(payload)
        .expect(200);

      const subscription = await waitFor(() =>
        prisma.subscription
          .findUnique({ where: { tenantId: owner.tenantId } })
          .then((row) => (row?.status === 'PAST_DUE' ? row : null)),
      );
      expect(subscription.stripeSubscriptionId).toBe('sub_webhook_test');

      const tenant = await prisma.tenant.findUnique({
        where: { id: owner.tenantId },
      });
      // Grace-period policy: PAST_DUE stays functional, not SUSPENDED.
      expect(tenant?.status).toBe('PAST_DUE');

      const webhookLog = await prisma.webhookLog.findUnique({
        where: {
          uq_webhook_logs_provider_event: {
            provider: 'STRIPE',
            providerEventId: eventId,
          },
        },
      });
      expect(webhookLog?.processingStatus).toBe('PROCESSED');
      expect(webhookLog?.tenantId).toBe(owner.tenantId);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('is idempotent: the same event id delivered twice is only ever logged once', async () => {
    const owner = await seedOwner(app, 'stripe-webhook-replay');
    let planId: string | undefined;
    try {
      const plan = await seedPlan(prisma);
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: plan.id,
        stripeCustomerId: 'cus_replay_test',
      });

      const eventId = `evt_${randomUUID()}`;
      const payload = subscriptionEventPayload({
        eventId,
        stripeSubscriptionId: 'sub_replay_test',
        stripeCustomerId: 'cus_replay_test',
        status: 'active',
        stripePriceId: plan.stripePriceId,
      });
      const rawBody = JSON.stringify(payload);
      const signature = signStripePayload(webhookSecret, rawBody);

      await request(app.getHttpServer())
        .post('/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signature)
        .send(payload)
        .expect(200);

      await waitFor(() =>
        prisma.webhookLog.findUnique({
          where: {
            uq_webhook_logs_provider_event: {
              provider: 'STRIPE',
              providerEventId: eventId,
            },
          },
        }),
      );

      // Stripe's at-least-once redelivery of the exact same event.
      await request(app.getHttpServer())
        .post('/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signature)
        .send(payload)
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const count = await prisma.webhookLog.count({
        where: { provider: 'STRIPE', providerEventId: eventId },
      });
      expect(count).toBe(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('invoice.paid resets the monthly AI/WhatsApp message counter', async () => {
    const owner = await seedOwner(app, 'stripe-webhook-invoice');
    let planId: string | undefined;
    try {
      const plan = await seedPlan(prisma);
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: plan.id,
        stripeCustomerId: 'cus_invoice_test',
        messagesUsedCurrentPeriod: 42,
      });

      const eventId = `evt_${randomUUID()}`;
      const payload = invoicePaidEventPayload({
        eventId,
        stripeInvoiceId: `in_${randomUUID()}`,
        stripeCustomerId: 'cus_invoice_test',
      });
      const rawBody = JSON.stringify(payload);

      await request(app.getHttpServer())
        .post('/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripePayload(webhookSecret, rawBody))
        .send(payload)
        .expect(200);

      const subscription = await waitFor(() =>
        prisma.subscription
          .findUnique({ where: { tenantId: owner.tenantId } })
          .then((row) => (row?.messagesUsedCurrentPeriod === 0 ? row : null)),
      );
      expect(subscription.messagesUsedCurrentPeriod).toBe(0);

      const invoice = await prisma.invoice.findFirst({
        where: { tenantId: owner.tenantId },
      });
      expect(invoice?.status).toBe('PAID');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });
});
