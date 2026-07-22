import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedManager,
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

describe('GET/PATCH /api/v1/salon (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('auto-vivifies a default SalonProfile on first read, composed with the existing Tenant fields', async () => {
    const owner = await seedOwner(app, 'salon-profile-backfill');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .get('/api/v1/salon')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'salon-profile-backfill Salon',
        currency: 'USD',
        description: null,
        contactEmail: null,
        logoUrl: null,
      });
      expect(response.body.data.timezone).toBe('UTC');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('updates both Tenant-owned and SalonProfile-owned fields in one call, reflected on the next read', async () => {
    const owner = await seedOwner(app, 'salon-profile-update');
    try {
      const token = await login(app, owner.email, owner.password);

      const patchResponse = await request(app.getHttpServer())
        .patch('/api/v1/salon')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Bella Salon Updated',
          city: 'Lisbon',
          contactEmail: 'hello@bellasalon.com',
          currency: 'EUR',
          primaryColor: '#4A90D9',
        })
        .expect(200);

      expect(patchResponse.body.data).toMatchObject({
        name: 'Bella Salon Updated',
        city: 'Lisbon',
        contactEmail: 'hello@bellasalon.com',
        currency: 'EUR',
        primaryColor: '#4A90D9',
      });

      const getResponse = await request(app.getHttpServer())
        .get('/api/v1/salon')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(getResponse.body.data).toMatchObject({
        name: 'Bella Salon Updated',
        city: 'Lisbon',
        contactEmail: 'hello@bellasalon.com',
        currency: 'EUR',
        primaryColor: '#4A90D9',
      });

      const tenantRow = await prisma.tenant.findUniqueOrThrow({
        where: { id: owner.tenantId },
      });
      expect(tenantRow.name).toBe('Bella Salon Updated');
      expect(tenantRow.city).toBe('Lisbon');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('MANAGER can update the profile; STAFF can read but not update it', async () => {
    const manager = await seedManager(app, 'salon-profile-manager');
    const staff = await seedStaff(app, 'salon-profile-staff');
    try {
      const managerToken = await login(app, manager.email, manager.password);
      await request(app.getHttpServer())
        .patch('/api/v1/salon')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ description: 'Updated by manager' })
        .expect(200);

      const staffToken = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/salon')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      const forbidden = await request(app.getHttpServer())
        .patch('/api/v1/salon')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ description: 'Hacked' })
        .expect(403);
      expect(forbidden.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, manager.tenantId);
      await cleanupTenant(prisma, staff.tenantId);
    }
  });

  it("Tenant A's salon profile update never leaks into Tenant B's", async () => {
    const ownerA = await seedOwner(app, 'salon-profile-iso-a');
    const ownerB = await seedOwner(app, 'salon-profile-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .patch('/api/v1/salon')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ description: 'Tenant A only' })
        .expect(200);

      const bResponse = await request(app.getHttpServer())
        .get('/api/v1/salon')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(bResponse.body.data.description).toBeNull();
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('blocks PATCH with 402 TENANT_SUSPENDED once suspended, while GET stays reachable', async () => {
    const owner = await seedOwner(app, 'salon-profile-suspend');
    try {
      const token = await login(app, owner.email, owner.password);

      await prisma.tenant.update({
        where: { id: owner.tenantId },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });

      const blocked = await request(app.getHttpServer())
        .patch('/api/v1/salon')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Should not apply' })
        .expect(402);
      expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

      await request(app.getHttpServer())
        .get('/api/v1/salon')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
