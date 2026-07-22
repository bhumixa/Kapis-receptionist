import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/login (integration)', () => {
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

  it('logs in with correct credentials and sets the httpOnly refresh cookie', async () => {
    const owner = await seedOwner(app, 'login-happy');
    createdTenantIds.push(owner.tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.expiresIn).toBe(900);
    expect(response.body.data.user.email).toBe(owner.email);

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    expect(setCookie).toBeDefined();
    const refreshCookie = setCookie.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=Strict/i);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/i);
  });

  it('rejects an unknown email with 401 INVALID_CREDENTIALS', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'nobody-at-all@integration-test.example.com',
        password: 'x',
      })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects the wrong password with the same INVALID_CREDENTIALS code as an unknown email', async () => {
    const owner = await seedOwner(app, 'login-wrong-pw');
    createdTenantIds.push(owner.tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'DefinitelyWrong1' })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a deactivated account with 401 ACCOUNT_DEACTIVATED', async () => {
    const owner = await seedOwner(app, 'login-deactivated');
    createdTenantIds.push(owner.tenantId);
    await prisma.user.update({
      where: { id: owner.userId },
      data: { isActive: false },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(401);
    expect(response.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });
});
