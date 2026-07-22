import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

/**
 * Kept in its own spec file (own `createTestApp()` / own in-memory
 * ThrottlerStorage instance) deliberately: this test alone needs 6 login
 * calls to exercise the 5-attempt lockout threshold
 * (docs/AUTHENTICATION.md — Sprint 2.3), which combined with
 * login.integration-spec.ts's other cases would exceed the
 * Public-Sensitive rate-limit tier's 10-req/min-per-IP budget
 * (API_SPECIFICATION.md Section 2.10) if they shared one app instance.
 */
describe('POST /api/v1/auth/login — account lockout (integration)', () => {
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

  it('locks the account after 5 failed attempts and blocks even a correct password with 403 ACCOUNT_LOCKED', async () => {
    const owner = await seedOwner(app, 'login-lockout');
    createdTenantIds.push(owner.tenantId);

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: 'DefinitelyWrong1' })
        .expect(401);
    }

    const lockedOut = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(403);
    expect(lockedOut.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});
