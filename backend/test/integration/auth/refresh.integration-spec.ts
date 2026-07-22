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

describe('POST /api/v1/auth/refresh (integration)', () => {
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

  it('rotates the refresh token and issues a new access token', async () => {
    const owner = await seedOwner(app, 'refresh-happy');
    createdTenantIds.push(owner.tenantId);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const originalCookie = extractRefreshCookie(
      loginResponse.headers['set-cookie'] as unknown as string[],
    );

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(200);

    // Not asserting this differs from the login-issued access token: JWT
    // `iat` has whole-second granularity, so a login->refresh round trip
    // completing within the same second legitimately produces an
    // identical token — the security-relevant property is refresh-token
    // rotation (asserted below), not access-token byte-uniqueness.
    expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));
    const rotatedCookie = extractRefreshCookie(
      refreshResponse.headers['set-cookie'] as unknown as string[],
    );
    expect(rotatedCookie).not.toBe(originalCookie);
  });

  it('detects reuse of an already-rotated refresh token and revokes the session chain', async () => {
    const owner = await seedOwner(app, 'refresh-reuse');
    createdTenantIds.push(owner.tenantId);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const originalCookie = extractRefreshCookie(
      loginResponse.headers['set-cookie'] as unknown as string[],
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(200); // legitimate rotation

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie) // replay of the now-stale token
      .expect(401);

    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('rejects a refresh call with no cookie at all', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a garbage refresh cookie as invalid rather than crashing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=not-a-real-token')
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_REFRESH_TOKEN');
  });
});
