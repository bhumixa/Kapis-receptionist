import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import { StripeClient } from '../../../src/modules/billing/infrastructure/stripe-client';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedManager,
} from '../support/test-app.factory';
import {
  cleanupPlan,
  FakeStripeClient,
  seedPlan,
  seedSubscription,
} from '../support/billing-fixtures';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('/api/v1/subscriptions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stripe: FakeStripeClient;

  beforeAll(async () => {
    stripe = new FakeStripeClient();
    app = await createTestApp([{ provide: StripeClient, useValue: stripe }]);
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    stripe.reset();
  });

  it('GET /subscriptions backfills a TRIALING subscription for a tenant seeded outside the registration flow', async () => {
    const owner = await seedOwner(app, 'sub-backfill');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.status).toBe('TRIALING');
      expect(response.body.data.hasStripeSubscription).toBe(false);

      const row = await prisma.subscription.findUnique({
        where: { tenantId: owner.tenantId },
      });
      expect(row).not.toBeNull();
      expect(row?.stripeCustomerId).toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('POST /subscriptions requires an Idempotency-Key header', async () => {
    const owner = await seedOwner(app, 'sub-no-idem');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;

      await request(app.getHttpServer())
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({ planId: plan.id })
        .expect(400);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('POST /subscriptions lazily creates a Stripe customer and returns a Checkout URL', async () => {
    const owner = await seedOwner(app, 'sub-checkout');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;

      const response = await request(app.getHttpServer())
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ planId: plan.id })
        .expect(201);

      expect(response.body.data.checkoutUrl).toBe(
        'https://stripe.test/checkout',
      );
      expect(stripe.calls.createCustomer).toHaveLength(1);
      expect(stripe.calls.createCustomer[0].email).toBe(owner.email);

      const row = await prisma.subscription.findUnique({
        where: { tenantId: owner.tenantId },
      });
      expect(row?.stripeCustomerId).toMatch(/^cus_fake_/);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('MANAGER can read but cannot create a checkout session (billing:manage is OWNER-only)', async () => {
    const manager = await seedManager(app, 'sub-manager-scope');
    let planId: string | undefined;
    try {
      const managerToken = await login(app, manager.email, manager.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;

      await request(app.getHttpServer())
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ planId: plan.id })
        .expect(403);
    } finally {
      await cleanupTenant(prisma, manager.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('POST /subscriptions/change-plan calls Stripe when a live Stripe subscription exists, and updates locally', async () => {
    const owner = await seedOwner(app, 'sub-change-plan');
    let planAId: string | undefined;
    let planBId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const planA = await seedPlan(prisma, { name: 'Plan A' });
      const planB = await seedPlan(prisma, { name: 'Plan B' });
      planAId = planA.id;
      planBId = planB.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: planA.id,
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: 'sub_existing',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ planId: planB.id })
        .expect(201);

      expect(response.body.data.planId).toBe(planB.id);
      expect(stripe.calls.changeSubscriptionPrice).toContainEqual({
        subscriptionId: 'sub_existing',
        priceId: planB.stripePriceId,
      });
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planAId) await cleanupPlan(prisma, planAId);
      if (planBId) await cleanupPlan(prisma, planBId);
    }
  });

  it('POST /subscriptions/cancel then /reactivate round-trips cancelAtPeriodEnd for a live Stripe subscription', async () => {
    const owner = await seedOwner(app, 'sub-cancel-reactivate');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: plan.id,
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: 'sub_existing',
      });

      const cancelResponse = await request(app.getHttpServer())
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(cancelResponse.body.data.cancelAtPeriodEnd).toBe(true);
      expect(stripe.calls.cancelAtPeriodEnd).toContain('sub_existing');

      await request(app.getHttpServer())
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      const reactivateResponse = await request(app.getHttpServer())
        .post('/api/v1/subscriptions/reactivate')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(reactivateResponse.body.data.cancelAtPeriodEnd).toBe(false);
      expect(stripe.calls.resumeSubscription).toContain('sub_existing');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('POST /subscriptions/cancel on a trial-only subscription (no Stripe subscription) cancels immediately and blocks mutating routes', async () => {
    const owner = await seedOwner(app, 'sub-trial-cancel');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, { planId: plan.id });

      const response = await request(app.getHttpServer())
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(response.body.data.status).toBe('CANCELED');
      expect(stripe.calls.cancelAtPeriodEnd).toHaveLength(0);

      const tenant = await prisma.tenant.findUnique({
        where: { id: owner.tenantId },
      });
      expect(tenant?.status).toBe('CANCELLED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('POST /subscriptions/portal-session requires a Stripe customer to already exist', async () => {
    const owner = await seedOwner(app, 'sub-portal-none');
    try {
      const token = await login(app, owner.email, owner.password);

      await request(app.getHttpServer())
        .post('/api/v1/subscriptions/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .expect(422);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('POST /subscriptions/portal-session returns a portal URL once a Stripe customer exists', async () => {
    const owner = await seedOwner(app, 'sub-portal-ok');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma);
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, {
        planId: plan.id,
        stripeCustomerId: 'cus_existing',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/subscriptions/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(response.body.data.url).toBe('https://stripe.test/portal');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });
});
