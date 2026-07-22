import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import { TokenService } from '../../../src/modules/auth/application/token.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  SeededOwner,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/reset-password (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await cleanupTenant(prisma, tenantId);
    }
    await app.close();
  });

  /** Seeds an owner and a known-raw-token PasswordReset row directly (bypassing `/auth/forgot-password`, whose email delivers a token this spec has no other way to intercept). */
  async function seedOwnerWithResetToken(
    label: string,
    rawToken: string,
    expiresAt: Date = new Date(Date.now() + 1000 * 60 * 60),
  ): Promise<SeededOwner> {
    const owner = await seedOwner(app, label);
    await prisma.passwordReset.create({
      data: {
        userId: owner.userId,
        tokenHash: tokens.hashOpaqueToken(rawToken),
        expiresAt,
      },
    });
    return owner;
  }

  it('updates the password, allows login with the new password, and revokes existing sessions', async () => {
    const owner = await seedOwnerWithResetToken(
      'reset-happy',
      'reset-token-happy',
    );
    createdTenantIds.push(owner.tenantId);

    const loginBefore = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
    const cookieBefore = (
      loginBefore.headers['set-cookie'] as unknown as string[]
    )
      .find((c) => c.startsWith('refresh_token='))!
      .split(';')[0];

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token-happy', newPassword: 'N3wStr0ngP@ss!' })
      .expect(200);
    expect(response.body.data.message).toMatch(/password updated/i);

    // Old password no longer works.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(401);

    // New password works.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'N3wStr0ngP@ss!' })
      .expect(200);

    // The session that existed before the reset is revoked.
    const refreshAfterReset = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieBefore)
      .expect(401);
    expect(refreshAfterReset.body.error.code).toBe(
      'INVALID_OR_EXPIRED_REFRESH_TOKEN',
    );
  });

  it('rejects an unknown token with 400 INVALID_OR_EXPIRED_TOKEN', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', newPassword: 'N3wStr0ngP@ss!' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects reuse of an already-used token', async () => {
    const owner = await seedOwnerWithResetToken(
      'reset-reuse',
      'reset-token-reuse',
    );
    createdTenantIds.push(owner.tenantId);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token-reuse', newPassword: 'N3wStr0ngP@ss!' })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token-reuse', newPassword: 'AnotherP@ss1' })
      .expect(400);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired token', async () => {
    const owner = await seedOwnerWithResetToken(
      'reset-expired',
      'reset-token-expired',
      new Date(Date.now() - 1000),
    );
    createdTenantIds.push(owner.tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token-expired', newPassword: 'N3wStr0ngP@ss!' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects a weak new password with 422 VALIDATION_ERROR', async () => {
    const owner = await seedOwnerWithResetToken(
      'reset-weak-pw',
      'reset-token-weak-pw',
    );
    createdTenantIds.push(owner.tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token-weak-pw', newPassword: 'weak' })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
