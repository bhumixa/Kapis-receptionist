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

describe('GET/POST/PATCH/DELETE /api/v1/services (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports the full CRUD lifecycle, buffer time, and records an audit entry for each mutation', async () => {
    const owner = await seedOwner(app, 'svc-crud');
    try {
      const token = await login(app, owner.email, owner.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Haircut & Blow-Dry',
          durationMinutes: 45,
          priceCents: 8000,
          bufferTimeMinutes: 10,
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        name: 'Haircut & Blow-Dry',
        durationMinutes: 45,
        priceCents: 8000,
        bufferTimeMinutes: 10,
        isActive: true,
      });
      const serviceId = created.body.data.id as string;

      const fetched = await request(app.getHttpServer())
        .get(`/api/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(fetched.body.data.id).toBe(serviceId);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ priceCents: 9000, isActive: false })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        priceCents: 9000,
        isActive: false,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Service' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'SERVICE_CREATED',
        'SERVICE_UPDATED',
        'SERVICE_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a categoryId that does not belong to the tenant with 422 VALIDATION_ERROR-shaped response', async () => {
    const owner = await seedOwner(app, 'svc-invalid-category');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Manicure',
          durationMinutes: 30,
          priceCents: 3000,
          categoryId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_CATEGORY_REFERENCE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('supports pagination and category filtering', async () => {
    const owner = await seedOwner(app, 'svc-list');
    try {
      const token = await login(app, owner.email, owner.password);

      const category = await request(app.getHttpServer())
        .post('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nails' })
        .expect(201);
      const categoryId = category.body.data.id as string;

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/services')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: `Service ${i}`,
            durationMinutes: 30,
            priceCents: 1000,
            categoryId,
          })
          .expect(201);
      }
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Uncategorized', durationMinutes: 20, priceCents: 500 })
        .expect(201);

      const filtered = await request(app.getHttpServer())
        .get(`/api/v1/services?categoryId=${categoryId}&limit=2`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(filtered.body.data).toHaveLength(2);
      expect(filtered.body.meta.pagination).toMatchObject({
        strategy: 'offset',
        totalItems: 3,
      });
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("Tenant A's service list never includes Tenant B's services", async () => {
    const ownerA = await seedOwner(app, 'svc-iso-a');
    const ownerB = await seedOwner(app, 'svc-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: "Tenant A's service",
          durationMinutes: 30,
          priceCents: 1000,
        })
        .expect(201);

      const bList = await request(app.getHttpServer())
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(bList.body.data).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('STAFF can read services but cannot create/update/delete them', async () => {
    const staff = await seedStaff(app, 'svc-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Should not be allowed',
          durationMinutes: 30,
          priceCents: 1000,
        })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });
});
