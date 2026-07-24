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

/**
 * IMPLEMENTATION_ROADMAP.md Sprint 6.1's explicit acceptance criterion: "a
 * scripted test firing many concurrent booking requests at the same
 * employee/slot results in exactly one success and the rest receiving `409
 * SLOT_NO_LONGER_AVAILABLE`, verified against the real database and Redis,
 * not mocked." Each concurrent request uses its own distinct
 * `Idempotency-Key` — otherwise they'd just replay each other via the
 * idempotency layer instead of genuinely racing for the same slot.
 */
describe('Appointments concurrent-booking race (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows exactly one concurrent request for the same employee/slot to succeed', async () => {
    const owner = await seedOwner(app, 'appt-race');
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(200);
      const token = response.body.data.accessToken as string;

      const setup = await seedBookableSetup(prisma, owner.tenantId);
      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880099' })
        .expect(201);
      const customerId = customer.body.data.id as string;
      const startTime = new Date(
        Date.now() + 48 * 60 * 60 * 1000,
      ).toISOString();

      const CONCURRENCY = 8;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app.getHttpServer())
            .post('/api/v1/appointments')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', randomUUID())
            .send({
              customerId,
              startTime,
              services: [
                { serviceId: setup.serviceId, employeeId: setup.employeeId },
              ],
            }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 201);
      const conflicted = results.filter((r) => r.status === 409);

      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(CONCURRENCY - 1);
      for (const result of conflicted) {
        expect(result.body.error.code).toBe('SLOT_NO_LONGER_AVAILABLE');
      }

      // Confirm against the real database: exactly one appointment row exists.
      const count = await prisma.appointment.count({
        where: { tenantId: owner.tenantId },
      });
      expect(count).toBe(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  }, 30000);
});
