import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  uniqueTestEmail,
} from '../support/test-app.factory';

describe('POST /api/v1/auth/register (integration)', () => {
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

  it('creates a Tenant + OWNER User and returns both, with no session issued', async () => {
    const email = uniqueTestEmail('register-happy');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Str0ngP@ss1',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Integration Test Salon',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.user.roles).toEqual(['OWNER']);
    expect(response.body.data.tenant.name).toBe('Integration Test Salon');
    expect(response.body.data.tenant.status).toBe('TRIAL');
    // No `password`/`passwordHash` field leaks into the response.
    expect(response.body.data.user.passwordHash).toBeUndefined();
    // Register does not establish a session (API_SPECIFICATION.md Section 4 —
    // see docs/adr/ADR-003-core-authentication.md for why).
    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();

    createdTenantIds.push(response.body.data.tenant.id);

    const persisted = await prisma.user.findUnique({ where: { email } });
    expect(persisted).not.toBeNull();
    expect(persisted?.passwordHash).not.toBe('Str0ngP@ss1');
  });

  it('rejects a duplicate email with 409 EMAIL_ALREADY_EXISTS', async () => {
    const email = uniqueTestEmail('register-dup');
    const payload = {
      email,
      password: 'Str0ngP@ss1',
      firstName: 'Maria',
      lastName: 'Gomez',
      tenantName: 'Dup Test Salon',
      timezone: 'UTC',
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);
    createdTenantIds.push(first.body.data.tenant.id);

    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(409);
    expect(second.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects a weak password with 422 VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: uniqueTestEmail('register-weak-pw'),
        password: 'weak',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Weak PW Salon',
        timezone: 'UTC',
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      response.body.error.details.some(
        (d: { field: string }) => d.field === 'password',
      ),
    ).toBe(true);
  });

  it('rejects an invalid IANA timezone', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: uniqueTestEmail('register-bad-tz'),
        password: 'Str0ngP@ss1',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Bad TZ Salon',
        timezone: 'Not/ARealZone',
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
