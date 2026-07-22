import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('GET/PATCH /api/v1/tenant/settings (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a default row on first read for a tenant with no TenantSettings yet (pre-Milestone-3 backfill path)', async () => {
    const owner = await seedOwner(app, 'settings-backfill');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .get('/api/v1/tenant/settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toEqual({
        general: {},
        localization: {},
        business: {},
        notifications: {},
        security: {},
        updatedAt: expect.any(String),
      });
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('shallow-merges a namespace update, leaving other keys in that namespace and other namespaces untouched', async () => {
    const owner = await seedOwner(app, 'settings-merge');
    try {
      const token = await login(app, owner.email, owner.password);

      await request(app.getHttpServer())
        .patch('/api/v1/tenant/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ general: { a: 1, b: 2 } })
        .expect(200);

      const second = await request(app.getHttpServer())
        .patch('/api/v1/tenant/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ general: { b: 3 }, localization: { currency: 'BRL' } })
        .expect(200);

      expect(second.body.data.general).toEqual({ a: 1, b: 3 });
      expect(second.body.data.localization).toEqual({ currency: 'BRL' });
      expect(second.body.data.business).toEqual({});
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("Tenant A's settings update never leaks into Tenant B's settings", async () => {
    const ownerA = await seedOwner(app, 'settings-iso-a');
    const ownerB = await seedOwner(app, 'settings-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .patch('/api/v1/tenant/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ general: { secret: 'tenant-a-only' } })
        .expect(200);

      const bResponse = await request(app.getHttpServer())
        .get('/api/v1/tenant/settings')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(bResponse.body.data.general).toEqual({});
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });
});
