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

describe('GET/POST/PATCH/DELETE /api/v1/service-categories (integration)', () => {
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
    const owner = await seedOwner(app, 'svccat-crud');
    try {
      const token = await login(app, owner.email, owner.password);

      const empty = await request(app.getHttpServer())
        .get('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(empty.body.data).toEqual([]);

      const created = await request(app.getHttpServer())
        .post('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hair' })
        .expect(201);
      expect(created.body.data).toMatchObject({
        name: 'Hair',
        displayOrder: 0,
      });
      const categoryId = created.body.data.id as string;

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/service-categories/${categoryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hair & Styling' })
        .expect(200);
      expect(updated.body.data.name).toBe('Hair & Styling');

      await request(app.getHttpServer())
        .delete(`/api/v1/service-categories/${categoryId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const afterDelete = await request(app.getHttpServer())
        .get('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterDelete.body.data).toEqual([]);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'ServiceCategory' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'SERVICE_CATEGORY_CREATED',
        'SERVICE_CATEGORY_UPDATED',
        'SERVICE_CATEGORY_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 (never 403) for a PATCH/DELETE on another tenant's category", async () => {
    const ownerA = await seedOwner(app, 'svccat-cross-a');
    const ownerB = await seedOwner(app, 'svccat-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/service-categories')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: "Tenant A's category" })
        .expect(201);
      const categoryId = created.body.data.id as string;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/api/v1/service-categories/${categoryId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hacked' })
        .expect(404);
      expect(patchResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/api/v1/service-categories/${categoryId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(deleteResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("Tenant A's category list never includes Tenant B's categories", async () => {
    const ownerA = await seedOwner(app, 'svccat-iso-a');
    const ownerB = await seedOwner(app, 'svccat-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/service-categories')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: "Tenant A's category" })
        .expect(201);

      const bList = await request(app.getHttpServer())
        .get('/api/v1/service-categories')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(bList.body.data).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('STAFF can list categories but cannot create them', async () => {
    const staff = await seedStaff(app, 'svccat-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/service-categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Should not be allowed' })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });
});
