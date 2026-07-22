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

/**
 * Milestone 3 (docs/adr/ADR-006) changed `TenantScopedGuard`'s behavior:
 * resolution now goes entirely through `TenantContextService`, which means
 * a `SUPER_ADMIN` with **no** `X-Impersonate-Tenant-Id` header now *fails*
 * this guard (there's no "my tenant" for a Super Admin acting on a
 * genuinely tenant-scoped resource) — a deliberate behavior change from the
 * original Sprint 2.4 version, which let `SUPER_ADMIN` through
 * unconditionally with a `null` tenantId. See that guard's doc comment.
 */
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

  it('rejects SUPER_ADMIN with no impersonation header (no fixed tenant, none supplied)', async () => {
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
        .expect(403);

      expect(response.body.error.code).toBe('INVALID_TENANT_CONTEXT');
    } finally {
      await cleanupUser(prisma, admin.userId);
    }
  });

  it('resolves the impersonated tenant for SUPER_ADMIN with a valid impersonation header', async () => {
    const admin = await seedSuperAdmin(app, 'tenant-scoped-admin-imp');
    const owner = await seedOwner(app, 'tenant-scoped-imp-target');
    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/tenant-scoped')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Impersonate-Tenant-Id', owner.tenantId)
        .expect(200);

      expect(response.body.data.tenantId).toBe(owner.tenantId);
    } finally {
      await cleanupUser(prisma, admin.userId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('returns 404 for SUPER_ADMIN impersonating a nonexistent tenant', async () => {
    const admin = await seedSuperAdmin(app, 'tenant-scoped-admin-404');
    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/tenant-scoped')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Impersonate-Tenant-Id', '00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(response.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupUser(prisma, admin.userId);
    }
  });

  it('ignores the impersonation header entirely for a non-SUPER_ADMIN caller (spoofing protection)', async () => {
    const owner = await seedOwner(app, 'tenant-scoped-spoof');
    const otherOwner = await seedOwner(app, 'tenant-scoped-spoof-target');
    try {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/internal/rbac-probe/tenant-scoped')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Impersonate-Tenant-Id', otherOwner.tenantId)
        .expect(200);

      // Still the caller's OWN tenant — the spoofed header had zero effect.
      expect(response.body.data.tenantId).toBe(owner.tenantId);
      expect(response.body.data.tenantId).not.toBe(otherOwner.tenantId);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
      await cleanupTenant(prisma, otherOwner.tenantId);
    }
  });
});
