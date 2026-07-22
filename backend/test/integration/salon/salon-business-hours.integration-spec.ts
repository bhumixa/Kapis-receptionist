import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

function makeDay(dayOfWeek: number, overrides: Record<string, unknown> = {}) {
  return {
    dayOfWeek,
    startTime: '09:00',
    endTime: '17:00',
    isClosed: false,
    ...overrides,
  };
}

function fullWeek() {
  return Array.from({ length: 7 }, (_, dayOfWeek) => makeDay(dayOfWeek));
}

describe('GET/PUT /api/v1/salon/business-hours (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults all 7 days to closed for a fresh tenant, without persisting anything', async () => {
    const owner = await seedOwner(app, 'business-hours-default');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .get('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(7);
      expect(
        response.body.data.every((day: { isClosed: boolean }) => day.isClosed),
      ).toBe(true);

      const rows = await prisma.businessHours.findMany({
        where: { tenantId: owner.tenantId },
      });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('PUT with a valid 7-day set round-trips correctly', async () => {
    const owner = await seedOwner(app, 'business-hours-roundtrip');
    try {
      const token = await login(app, owner.email, owner.password);
      const days = fullWeek();
      days[0] = makeDay(0, { isClosed: true });

      const putResponse = await request(app.getHttpServer())
        .put('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .send({ days })
        .expect(200);

      expect(putResponse.body.data).toHaveLength(7);
      expect(putResponse.body.data[0]).toMatchObject({
        dayOfWeek: 0,
        isClosed: true,
      });
      expect(putResponse.body.data[1]).toMatchObject({
        dayOfWeek: 1,
        isClosed: false,
        startTime: '09:00',
        endTime: '17:00',
      });

      const getResponse = await request(app.getHttpServer())
        .get('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getResponse.body.data[1]).toMatchObject({
        startTime: '09:00',
        endTime: '17:00',
      });
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a PUT with fewer than 7 days', async () => {
    const owner = await seedOwner(app, 'business-hours-short');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .put('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .send({ days: fullWeek().slice(0, 6) })
        .expect(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a PUT where endTime is not after startTime for an open day', async () => {
    const owner = await seedOwner(app, 'business-hours-badrange');
    try {
      const token = await login(app, owner.email, owner.password);
      const days = fullWeek();
      days[1] = makeDay(1, { startTime: '17:00', endTime: '09:00' });

      const response = await request(app.getHttpServer())
        .put('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .send({ days })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_BUSINESS_HOURS_SET');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('STAFF can read business hours but cannot update them', async () => {
    const staff = await seedStaff(app, 'business-hours-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .put('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .send({ days: fullWeek() })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });

  it("Tenant A's business hours update never leaks into Tenant B's", async () => {
    const ownerA = await seedOwner(app, 'business-hours-iso-a');
    const ownerB = await seedOwner(app, 'business-hours-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .put('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ days: fullWeek() })
        .expect(200);

      const bResponse = await request(app.getHttpServer())
        .get('/api/v1/salon/business-hours')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(
        bResponse.body.data.every((day: { isClosed: boolean }) => day.isClosed),
      ).toBe(true);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });
});
