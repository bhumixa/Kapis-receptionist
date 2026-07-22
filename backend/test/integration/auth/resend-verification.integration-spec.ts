import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  uniqueTestEmail,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/resend-verification (integration)', () => {
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

  it('returns a generic success message and issues a fresh token for an unverified account', async () => {
    const email = uniqueTestEmail('resend-happy');
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Str0ngP@ss1',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Resend Happy Salon',
        timezone: 'UTC',
      })
      .expect(201);
    createdTenantIds.push(register.body.data.tenant.id);
    const userId = register.body.data.user.id as string;

    const before = await prisma.emailVerification.findFirstOrThrow({
      where: { userId },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email })
      .expect(200);
    expect(response.body.data.message).toMatch(/verification link/i);

    // The prior token was invalidated (deleted) and replaced with a new one —
    // same row count (exactly one active token), different underlying row.
    const after = await prisma.emailVerification.findFirstOrThrow({
      where: { userId },
    });
    expect(after.id).not.toBe(before.id);
  });

  it('returns the same generic message for an email that does not exist (enumeration-safe)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'nobody-at-all@integration-test.example.com' })
      .expect(200);
    expect(response.body.data.message).toMatch(/verification link/i);
  });

  it('returns the same generic message for an already-verified account, without issuing a new token', async () => {
    const email = uniqueTestEmail('resend-verified');
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Str0ngP@ss1',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Resend Verified Salon',
        timezone: 'UTC',
      })
      .expect(201);
    createdTenantIds.push(register.body.data.tenant.id);
    const userId = register.body.data.user.id as string;

    await prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    });
    const before = await prisma.emailVerification.findFirstOrThrow({
      where: { userId },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email })
      .expect(200);

    const after = await prisma.emailVerification.findFirstOrThrow({
      where: { userId },
    });
    expect(after.id).toBe(before.id);
  });
});
