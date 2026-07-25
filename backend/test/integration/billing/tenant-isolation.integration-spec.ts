import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  cleanupUser,
  createTestApp,
  getPrisma,
  seedOwner,
  seedSuperAdmin,
} from '../support/test-app.factory';
import {
  cleanupPlan,
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

describe('Billing tenant isolation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /subscriptions never reflects another tenant's plan or usage", async () => {
    const tenantA = await seedOwner(app, 'iso-billing-a');
    const tenantB = await seedOwner(app, 'iso-billing-b');
    let planAId: string | undefined;
    let planBId: string | undefined;
    try {
      const planA = await seedPlan(prisma, { name: 'Plan A', maxStaff: 3 });
      const planB = await seedPlan(prisma, { name: 'Plan B', maxStaff: 30 });
      planAId = planA.id;
      planBId = planB.id;
      await seedSubscription(prisma, tenantA.tenantId, {
        planId: planA.id,
        messagesUsedCurrentPeriod: 5,
      });
      await seedSubscription(prisma, tenantB.tenantId, {
        planId: planB.id,
        messagesUsedCurrentPeriod: 999,
      });

      const tokenA = await login(app, tenantA.email, tenantA.password);
      const tokenB = await login(app, tenantB.email, tenantB.password);

      const responseA = await request(app.getHttpServer())
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(responseA.body.data.plan.maxStaff).toBe(3);
      expect(responseA.body.data.messagesUsedCurrentPeriod).toBe(5);

      const responseB = await request(app.getHttpServer())
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(responseB.body.data.plan.maxStaff).toBe(30);
      expect(responseB.body.data.messagesUsedCurrentPeriod).toBe(999);
    } finally {
      await cleanupTenant(prisma, tenantA.tenantId);
      await cleanupTenant(prisma, tenantB.tenantId);
      if (planAId) await cleanupPlan(prisma, planAId);
      if (planBId) await cleanupPlan(prisma, planBId);
    }
  });

  it('a regular OWNER cannot reach the Platform Admin billing lookup for any tenant', async () => {
    const owner = await seedOwner(app, 'iso-billing-admin-forbidden');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/tenants/${owner.tenantId}/billing`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("SUPER_ADMIN billing lookup returns each tenant's own subscription, never mixed", async () => {
    const tenantA = await seedOwner(app, 'iso-billing-admin-a');
    const tenantB = await seedOwner(app, 'iso-billing-admin-b');
    const admin = await seedSuperAdmin(app, 'iso-billing-admin-super');
    let planAId: string | undefined;
    let planBId: string | undefined;
    try {
      const planA = await seedPlan(prisma, { name: 'Admin Plan A' });
      const planB = await seedPlan(prisma, { name: 'Admin Plan B' });
      planAId = planA.id;
      planBId = planB.id;
      await seedSubscription(prisma, tenantA.tenantId, { planId: planA.id });
      await seedSubscription(prisma, tenantB.tenantId, { planId: planB.id });

      const adminToken = await login(app, admin.email, admin.password);

      const lookupA = await request(app.getHttpServer())
        .get(`/api/v1/admin/tenants/${tenantA.tenantId}/billing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(lookupA.body.data.subscription.plan.name).toBe('Admin Plan A');

      const lookupB = await request(app.getHttpServer())
        .get(`/api/v1/admin/tenants/${tenantB.tenantId}/billing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(lookupB.body.data.subscription.plan.name).toBe('Admin Plan B');
    } finally {
      await cleanupTenant(prisma, tenantA.tenantId);
      await cleanupTenant(prisma, tenantB.tenantId);
      await cleanupUser(prisma, admin.userId);
      if (planAId) await cleanupPlan(prisma, planAId);
      if (planBId) await cleanupPlan(prisma, planBId);
    }
  });

  it('the admin billing lookup 404s for a non-existent tenant id', async () => {
    const admin = await seedSuperAdmin(app, 'iso-billing-admin-404');
    try {
      const adminToken = await login(app, admin.email, admin.password);

      await request(app.getHttpServer())
        .get(
          '/api/v1/admin/tenants/00000000-0000-0000-0000-000000000000/billing',
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    } finally {
      await cleanupUser(prisma, admin.userId);
    }
  });
});
