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

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('/api/v1/admin/tenants (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-SUPER_ADMIN caller on every /admin/tenants endpoint', async () => {
    const owner = await seedOwner(app, 'admin-tenants-forbidden');
    try {
      const token = await login(app, owner.email, owner.password);

      const list = await request(app.getHttpServer())
        .get('/api/v1/admin/tenants')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(list.body.error.code).toBe('INSUFFICIENT_ROLE');

      const suspend = await request(app.getHttpServer())
        .post(`/api/v1/admin/tenants/${owner.tenantId}/suspend`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(suspend.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('lists tenants cross-tenant for SUPER_ADMIN, with offset pagination meta', async () => {
    const admin = await seedSuperAdmin(app, 'admin-tenants-list');
    const owner = await seedOwner(app, 'admin-tenants-list-target');
    try {
      const token = await login(app, admin.email, admin.password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tenants?limit=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(
        response.body.data.some((t: { id: string }) => t.id === owner.tenantId),
      ).toBe(true);
      expect(response.body.meta.pagination.strategy).toBe('offset');
    } finally {
      await cleanupUser(prisma, admin.userId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('suspends then reactivates a tenant, writing an AuditLog row for each transition', async () => {
    const admin = await seedSuperAdmin(app, 'admin-tenants-lifecycle');
    const owner = await seedOwner(app, 'admin-tenants-lifecycle-target');
    try {
      const token = await login(app, admin.email, admin.password);

      const suspend = await request(app.getHttpServer())
        .post(`/api/v1/admin/tenants/${owner.tenantId}/suspend`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'integration test' })
        .expect(201);
      expect(suspend.body.data.status).toBe('SUSPENDED');

      const reactivate = await request(app.getHttpServer())
        .post(`/api/v1/admin/tenants/${owner.tenantId}/reactivate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(reactivate.body.data.status).toBe('ACTIVE');

      const logs = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining(['TENANT_SUSPENDED', 'TENANT_REACTIVATED']),
      );
    } finally {
      await cleanupUser(prisma, admin.userId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects reactivating a tenant that is not currently SUSPENDED', async () => {
    const admin = await seedSuperAdmin(app, 'admin-tenants-invalid-transition');
    const owner = await seedOwner(
      app,
      'admin-tenants-invalid-transition-target',
    );
    try {
      const token = await login(app, admin.email, admin.password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/tenants/${owner.tenantId}/reactivate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(response.body.error.code).toBe('INVALID_LIFECYCLE_TRANSITION');
    } finally {
      await cleanupUser(prisma, admin.userId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
