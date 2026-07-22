import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import { SecurityEventService } from '../../../src/modules/auth/application/security-event.service';
import {
  cleanupUser,
  createTestApp,
  getPrisma,
  seedSuperAdmin,
} from '../support/test-app.factory';

/**
 * Cross-role access test for the SUPER_ADMIN bypass specifically (docs/adr/
 * ADR-005-rbac.md — the resolved deviation from SYSTEM_ARCHITECTURE.md
 * Section 8.4): a SUPER_ADMIN hitting a MANAGER-gated route succeeds, and
 * every bypass is logged via the real `SecurityEventService`, proving the
 * auditability mitigation, not just the access-grant behavior.
 */
describe('SUPER_ADMIN bypass (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('grants access to a role-gated route and logs SUPER_ADMIN_BYPASS', async () => {
    const admin = await seedSuperAdmin(app, 'bypass-admin');
    const securityEvents = app.get(SecurityEventService);
    const recordSpy = jest.spyOn(securityEvents, 'record');

    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/roles/manager-plus')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(recordSpy).toHaveBeenCalledWith(
        'SUPER_ADMIN_BYPASS',
        expect.objectContaining({
          userId: admin.userId,
          tenantId: null,
          type: 'role',
          requiredRoles: ['MANAGER'],
        }),
      );
    } finally {
      recordSpy.mockRestore();
      await cleanupUser(prisma, admin.userId);
    }
  });

  it('grants access to a permission-gated route and logs SUPER_ADMIN_BYPASS', async () => {
    const admin = await seedSuperAdmin(app, 'bypass-admin-perm');
    const securityEvents = app.get(SecurityEventService);
    const recordSpy = jest.spyOn(securityEvents, 'record');

    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/permissions/billing-manage')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(recordSpy).toHaveBeenCalledWith(
        'SUPER_ADMIN_BYPASS',
        expect.objectContaining({
          userId: admin.userId,
          tenantId: null,
          type: 'permission',
          requiredPermission: 'billing:manage',
        }),
      );
    } finally {
      recordSpy.mockRestore();
      await cleanupUser(prisma, admin.userId);
    }
  });
});
