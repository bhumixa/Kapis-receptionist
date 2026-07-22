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

describe('GET/POST/PATCH/DELETE /api/v1/salon/holidays (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports the full CRUD lifecycle and records an audit entry for each mutation', async () => {
    const owner = await seedOwner(app, 'holidays-crud');
    try {
      const token = await login(app, owner.email, owner.password);

      const empty = await request(app.getHttpServer())
        .get('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(empty.body.data).toEqual([]);

      const created = await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-12-25', reason: 'Christmas Day' })
        .expect(201);
      expect(created.body.data).toMatchObject({
        date: '2026-12-25',
        reason: 'Christmas Day',
      });
      const holidayId = created.body.data.id as string;

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/salon/holidays/${holidayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Christmas Day (Observed)' })
        .expect(200);
      expect(updated.body.data.reason).toBe('Christmas Day (Observed)');

      const list = await request(app.getHttpServer())
        .get('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toHaveLength(1);

      await request(app.getHttpServer())
        .delete(`/api/v1/salon/holidays/${holidayId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const afterDelete = await request(app.getHttpServer())
        .get('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterDelete.body.data).toEqual([]);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Holiday' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'SALON_HOLIDAY_CREATED',
        'SALON_HOLIDAY_UPDATED',
        'SALON_HOLIDAY_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects creating a second holiday on the same date with 409 CONFLICT', async () => {
    const owner = await seedOwner(app, 'holidays-duplicate');
    try {
      const token = await login(app, owner.email, owner.password);

      await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-01-01', reason: "New Year's Day" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-01-01', reason: 'Duplicate' })
        .expect(409);
      expect(response.body.error.code).toBe('DUPLICATE_HOLIDAY_DATE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 (never 403) for a PATCH/DELETE on another tenant's holiday", async () => {
    const ownerA = await seedOwner(app, 'holidays-cross-a');
    const ownerB = await seedOwner(app, 'holidays-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ date: '2026-07-04', reason: "Tenant A's holiday" })
        .expect(201);
      const holidayId = created.body.data.id as string;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/api/v1/salon/holidays/${holidayId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ reason: 'Hacked' })
        .expect(404);
      expect(patchResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/api/v1/salon/holidays/${holidayId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(deleteResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');

      // Never actually deleted by Tenant B's rejected request.
      const stillThere = await prisma.holiday.findUnique({
        where: { id: holidayId },
      });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("Tenant A's holiday list never includes Tenant B's holidays", async () => {
    const ownerA = await seedOwner(app, 'holidays-iso-a');
    const ownerB = await seedOwner(app, 'holidays-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ date: '2026-05-01', reason: "Tenant A's holiday" })
        .expect(201);

      const bList = await request(app.getHttpServer())
        .get('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(bList.body.data).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('STAFF can list holidays but cannot create them', async () => {
    const staff = await seedStaff(app, 'holidays-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/salon/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-03-08', reason: 'Should not be allowed' })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });
});
