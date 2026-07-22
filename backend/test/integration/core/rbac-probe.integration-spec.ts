import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  cleanupUser,
  createTestApp,
  getPrisma,
  seedManager,
  seedOwner,
  seedStaff,
  seedSuperAdmin,
  SeededUser,
} from '../support/test-app.factory';

/**
 * The authorization matrix test (docs/adr/ADR-005-rbac.md): one real user
 * per role, logged in via real `POST /auth/login` (never a hand-constructed
 * JWT), asserting every `rbac-probe` route returns the expected status for
 * every role. Derived directly from `prisma/seed.ts`'s current
 * `ROLE_PERMISSIONS` matrix — this test doubles as a regression guard on it.
 */
describe('RBAC authorization matrix (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  const tokens: Record<'STAFF' | 'MANAGER' | 'OWNER' | 'SUPER_ADMIN', string> =
    {} as never;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);

    const seeded: Record<string, SeededUser> = {
      STAFF: await seedStaff(app, 'matrix-staff'),
      MANAGER: await seedManager(app, 'matrix-manager'),
      OWNER: await seedOwner(app, 'matrix-owner'),
      SUPER_ADMIN: await seedSuperAdmin(app, 'matrix-super-admin'),
    };

    for (const [role, user] of Object.entries(seeded)) {
      createdUserIds.push(user.userId);
      if (user.tenantId) {
        createdTenantIds.push(user.tenantId);
      }
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      tokens[role as keyof typeof tokens] = loginResponse.body.data
        .accessToken as string;
    }
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await cleanupTenant(prisma, tenantId);
    }
    // seedSuperAdmin's user has no tenant, so it isn't covered by
    // cleanupTenant's `user.deleteMany({ where: { tenantId } })` above.
    for (const userId of createdUserIds) {
      await cleanupUser(prisma, userId);
    }
    await app.close();
  });

  function get(role: keyof typeof tokens, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/internal/rbac-probe/${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
  }

  it('is reachable by every authenticated role when no @Roles()/@RequirePermission() is declared', async () => {
    for (const role of ['STAFF', 'MANAGER', 'OWNER', 'SUPER_ADMIN'] as const) {
      await get(role, 'whoami').expect(200);
    }
  });

  const matrix: Array<{
    path: string;
    STAFF: number;
    MANAGER: number;
    OWNER: number;
    SUPER_ADMIN: number;
  }> = [
    {
      path: 'roles/manager-plus',
      STAFF: 403,
      MANAGER: 200,
      OWNER: 200,
      SUPER_ADMIN: 200,
    },
    {
      path: 'roles/owner-only',
      STAFF: 403,
      MANAGER: 403,
      OWNER: 200,
      SUPER_ADMIN: 200,
    },
    {
      path: 'permissions/billing-manage',
      STAFF: 403,
      MANAGER: 403,
      OWNER: 200,
      SUPER_ADMIN: 200,
    },
    {
      path: 'permissions/staff-invite',
      STAFF: 403,
      MANAGER: 200,
      OWNER: 200,
      SUPER_ADMIN: 200,
    },
    {
      path: 'super-admin-only',
      STAFF: 403,
      MANAGER: 403,
      OWNER: 403,
      SUPER_ADMIN: 200,
    },
  ];

  it.each(matrix)('$path', async (row) => {
    for (const role of ['STAFF', 'MANAGER', 'OWNER', 'SUPER_ADMIN'] as const) {
      await get(role, row.path).expect(row[role]);
    }
  });
});
