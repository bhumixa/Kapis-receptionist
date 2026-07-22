import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

function extractRefreshCookie(setCookie: string[]): string {
  const cookie = setCookie.find((c) => c.startsWith('refresh_token='));
  if (!cookie) throw new Error('refresh_token cookie not set');
  return cookie.split(';')[0];
}

describe('POST /api/v1/auth/logout (integration)', () => {
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

  it('revokes the session and clears the refresh cookie; the session cannot refresh afterward', async () => {
    const owner = await seedOwner(app, 'logout-happy');
    createdTenantIds.push(owner.tenantId);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const cookie = extractRefreshCookie(
      loginResponse.headers['set-cookie'] as unknown as string[],
    );
    const accessToken = loginResponse.body.data.accessToken as string;

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(logoutResponse.body.data.message).toBe('Logged out.');

    const clearedCookie = (
      logoutResponse.headers['set-cookie'] as unknown as string[]
    ).find((c) => c.startsWith('refresh_token='));
    expect(clearedCookie).toMatch(/refresh_token=;/);

    // Revoked via plain logout — a subsequent refresh must be a plain
    // "invalid" outcome, not reuse-detection (session.service.spec.ts
    // covers this distinction at the unit level; this proves it end to end).
    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
    expect(refreshAfterLogout.body.error.code).toBe(
      'INVALID_OR_EXPIRED_REFRESH_TOKEN',
    );
  });

  it('rejects logout without a bearer token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logging out twice is a safe no-op the second time (idempotent)', async () => {
    const owner = await seedOwner(app, 'logout-twice');
    createdTenantIds.push(owner.tenantId);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const cookie = extractRefreshCookie(
      loginResponse.headers['set-cookie'] as unknown as string[],
    );
    const accessToken = loginResponse.body.data.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });
});
