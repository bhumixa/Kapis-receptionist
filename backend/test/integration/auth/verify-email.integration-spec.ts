import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import { TokenService } from '../../../src/modules/auth/application/token.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  uniqueTestEmail,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/verify-email (integration)', () => {
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

  /** Registers a fresh user (register issues its own random token) and overwrites the stored hash to a known raw token this spec controls. */
  async function registerWithKnownToken(
    label: string,
    rawToken: string,
  ): Promise<{ userId: string; tenantId: string; email: string }> {
    const email = uniqueTestEmail(label);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Str0ngP@ss1',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: `${label} Salon`,
        timezone: 'UTC',
      })
      .expect(201);

    const userId = response.body.data.user.id as string;
    const tenantId = response.body.data.tenant.id as string;

    await prisma.emailVerification.updateMany({
      where: { userId },
      data: { tokenHash: tokens.hashOpaqueToken(rawToken) },
    });

    return { userId, tenantId, email };
  }

  it('verifies the email for a valid, unexpired token and flips isEmailVerified', async () => {
    const { userId, tenantId } = await registerWithKnownToken(
      'verify-happy',
      'verify-token-happy',
    );
    createdTenantIds.push(tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token-happy' })
      .expect(200);

    expect(response.body.data.user.isEmailVerified).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isEmailVerified).toBe(true);
  });

  it('rejects an unknown token with 400 INVALID_OR_EXPIRED_TOKEN', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects reuse of an already-verified token', async () => {
    const { tenantId } = await registerWithKnownToken(
      'verify-reuse',
      'verify-token-reuse',
    );
    createdTenantIds.push(tenantId);

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token-reuse' })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token-reuse' })
      .expect(400);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired token', async () => {
    const { tenantId } = await registerWithKnownToken(
      'verify-expired',
      'verify-token-expired',
    );
    createdTenantIds.push(tenantId);

    await prisma.emailVerification.updateMany({
      where: { tokenHash: tokens.hashOpaqueToken('verify-token-expired') },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token-expired' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });
});
