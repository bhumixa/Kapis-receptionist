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

describe('GET/PATCH /api/v1/tenant (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the caller's own tenant profile", async () => {
    const owner = await seedOwner(app, 'tenant-profile-owner');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .get('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.data.id).toBe(owner.tenantId);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('STAFF can read the profile but cannot update it', async () => {
    const staff = await seedStaff(app, 'tenant-profile-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });

  it("updating Tenant A's profile never affects Tenant B", async () => {
    const ownerA = await seedOwner(app, 'tenant-profile-a');
    const ownerB = await seedOwner(app, 'tenant-profile-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);

      await request(app.getHttpServer())
        .patch('/api/v1/tenant')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ city: 'Tenant A City' })
        .expect(200);

      const tenantB = await prisma.tenant.findUniqueOrThrow({
        where: { id: ownerB.tenantId },
      });
      expect(tenantB.city).not.toBe('Tenant A City');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('blocks a mutating request with 402 TENANT_SUSPENDED once the tenant is suspended, and unblocks it once reactivated', async () => {
    const owner = await seedOwner(app, 'tenant-profile-suspend');
    try {
      const token = await login(app, owner.email, owner.password);

      await prisma.tenant.update({
        where: { id: owner.tenantId },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });

      const blocked = await request(app.getHttpServer())
        .patch('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .send({ city: 'Should Not Apply' })
        .expect(402);
      expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

      // Reads remain reachable while suspended.
      await request(app.getHttpServer())
        .get('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await prisma.tenant.update({
        where: { id: owner.tenantId },
        data: { status: 'ACTIVE', suspendedAt: null },
      });

      await request(app.getHttpServer())
        .patch('/api/v1/tenant')
        .set('Authorization', `Bearer ${token}`)
        .send({ city: 'Now Allowed' })
        .expect(200);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
