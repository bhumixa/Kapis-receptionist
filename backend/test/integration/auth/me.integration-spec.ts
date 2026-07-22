import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

describe('GET /api/v1/auth/me (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await cleanupTenant(prisma, tenantId);
    }
    await app.close();
  });

  it('returns the authenticated user and their tenant', async () => {
    const owner = await seedOwner(app, 'me-happy');
    createdTenantIds.push(owner.tenantId);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const accessToken = loginResponse.body.data.accessToken as string;

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.user.id).toBe(owner.userId);
    expect(response.body.data.user.email).toBe(owner.email);
    expect(response.body.data.tenant.id).toBe(owner.tenantId);
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed/garbage bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
