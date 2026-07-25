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
import { seedBookableSetup } from '../support/scheduling-fixtures';
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

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

/**
 * Milestone 9's centralized `EntitlementService`, exercised end-to-end
 * through two independent consuming modules (Employees, Appointments) —
 * proves the gate is real plan-driven enforcement, not a per-module
 * reimplementation (the milestone's explicit requirement: "every module
 * must use the centralized entitlement service instead of checking plan
 * names directly").
 */
describe('Feature entitlement enforcement (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /employees returns 403 PLAN_LIMIT_EXCEEDED once the plan staff limit is reached', async () => {
    const owner = await seedOwner(app, 'entitlement-staff');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma, { maxStaff: 1 });
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, { planId: plan.id });

      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Ana', lastName: 'Silva' })
        .expect(201);

      const rejected = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Bea', lastName: 'Costa' })
        .expect(403);
      expect(rejected.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');

      const count = await prisma.employee.count({
        where: { tenantId: owner.tenantId, deletedAt: null },
      });
      expect(count).toBe(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('a plan with maxStaff: null (unlimited) never blocks employee creation', async () => {
    const owner = await seedOwner(app, 'entitlement-staff-unlimited');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const plan = await seedPlan(prisma, { maxStaff: null });
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, { planId: plan.id });

      for (const name of ['Ana', 'Bea', 'Carla']) {
        await request(app.getHttpServer())
          .post('/api/v1/employees')
          .set('Authorization', `Bearer ${token}`)
          .send({ firstName: name, lastName: 'Silva' })
          .expect(201);
      }

      const count = await prisma.employee.count({
        where: { tenantId: owner.tenantId, deletedAt: null },
      });
      expect(count).toBe(3);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });

  it('POST /appointments returns 403 PLAN_LIMIT_EXCEEDED once the monthly appointment limit is reached', async () => {
    const owner = await seedOwner(app, 'entitlement-appointments');
    let planId: string | undefined;
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);
      const plan = await seedPlan(prisma, { maxAppointmentsPerMonth: 1 });
      planId = plan.id;
      await seedSubscription(prisma, owner.tenantId, { planId: plan.id });

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880002' })
        .expect(201);
      const customerId = customer.body.data.id as string;

      await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime: futureIso(24),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(201);

      const rejected = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime: futureIso(72),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(403);
      expect(rejected.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      if (planId) await cleanupPlan(prisma, planId);
    }
  });
});
