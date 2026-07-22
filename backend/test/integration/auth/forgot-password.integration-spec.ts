import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/forgot-password (integration)', () => {
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

  it('returns a generic success message and creates a reset token when the account exists', async () => {
    const owner = await seedOwner(app, 'forgot-happy');
    createdTenantIds.push(owner.tenantId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: owner.email })
      .expect(200);
    expect(response.body.data.message).toMatch(/reset link/i);

    const reset = await prisma.passwordReset.findFirst({
      where: { userId: owner.userId },
    });
    expect(reset).not.toBeNull();
  });

  it('returns the identical generic message for an email that does not exist (enumeration-safe)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody-at-all@integration-test.example.com' })
      .expect(200);
    expect(response.body.data.message).toMatch(/reset link/i);
  });

  it('invalidates a prior unused reset token when a new one is requested', async () => {
    const owner = await seedOwner(app, 'forgot-twice');
    createdTenantIds.push(owner.tenantId);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: owner.email })
      .expect(200);
    const first = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: owner.userId },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: owner.email })
      .expect(200);
    const second = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: owner.userId },
    });

    expect(second.id).not.toBe(first.id);
  });
});
