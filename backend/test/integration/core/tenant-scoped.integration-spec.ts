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

describe('TenantScopedGuard (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the caller's own tenantId for a tenant-scoped role", async () => {
    const owner = await seedOwner(app, 'tenant-scoped-owner');
    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/tenant-scoped')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.tenantId).toBe(owner.tenantId);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('succeeds with no fixed tenant for SUPER_ADMIN', async () => {
    const admin = await seedSuperAdmin(app, 'tenant-scoped-admin');
    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/tenant-scoped')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.tenantId).toBeNull();
    } finally {
      await cleanupUser(prisma, admin.userId);
    }
  });
});
