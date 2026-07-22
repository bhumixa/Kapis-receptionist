import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import { NotificationsService } from '../../../src/modules/notifications/application/notifications.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

/** Extracts the raw invitation token from the (mocked) email body, mirroring how a real invitee would follow the link. */
function extractTokenFromEmail(sendEmailMock: jest.SpyInstance): string {
  const call = sendEmailMock.mock.calls.find((c) =>
    (c[0].text as string).includes('accept-invitation'),
  );
  const match = (call?.[0].text as string).match(/accept-invitation\/([^\s]+)/);
  if (!match) {
    throw new Error('No invitation token found in sent email');
  }
  return match[1];
}

describe('Tenant invitations (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sendEmailSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  beforeEach(() => {
    sendEmailSpy = jest
      .spyOn(app.get(NotificationsService), 'sendEmail')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an invitation, prevents a duplicate pending one, and lists it as pending', async () => {
    const owner = await seedOwner(app, 'invite-create');
    try {
      const token = await login(app, owner.email, owner.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'ana@salon.com', role: 'STAFF' })
        .expect(201);
      expect(created.body.data.role).toBe('STAFF');

      const duplicate = await request(app.getHttpServer())
        .post('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'ana@salon.com', role: 'STAFF' })
        .expect(409);
      expect(duplicate.body.error.code).toBe('INVITATION_ALREADY_PENDING');

      const list = await request(app.getHttpServer())
        .get('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].email).toBe('ana@salon.com');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("Tenant A cannot list or revoke Tenant B's invitations", async () => {
    const ownerA = await seedOwner(app, 'invite-iso-a');
    const ownerB = await seedOwner(app, 'invite-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ email: 'target@salon.com', role: 'STAFF' })
        .expect(201);

      const listA = await request(app.getHttpServer())
        .get('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(listA.body.data).toHaveLength(0);

      const revokeAttempt = await request(app.getHttpServer())
        .delete(`/api/v1/tenant/invitations/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
      expect(revokeAttempt.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('revokes a pending invitation, idempotently', async () => {
    const owner = await seedOwner(app, 'invite-revoke');
    try {
      const token = await login(app, owner.email, owner.password);
      const created = await request(app.getHttpServer())
        .post('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'revoke-me@salon.com', role: 'MANAGER' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/tenant/invitations/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Idempotent — revoking again is a safe no-op, not an error.
      await request(app.getHttpServer())
        .delete(`/api/v1/tenant/invitations/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toHaveLength(0);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('POST /auth/accept-invitation creates the invited user in the inviting tenant and logs them in', async () => {
    const owner = await seedOwner(app, 'invite-accept');
    try {
      const token = await login(app, owner.email, owner.password);

      await request(app.getHttpServer())
        .post('/api/v1/tenant/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'newstaff@salon.com', role: 'STAFF' })
        .expect(201);

      const rawToken = extractTokenFromEmail(sendEmailSpy);

      const acceptResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invitation')
        .send({
          token: rawToken,
          firstName: 'New',
          lastName: 'Staff',
          password: 'Str0ngP@ss1',
        })
        .expect(200);

      expect(acceptResponse.body.data.user.email).toBe('newstaff@salon.com');
      expect(acceptResponse.body.data.user.roles).toEqual(['STAFF']);
      expect(acceptResponse.body.data.tenant.id).toBe(owner.tenantId);
      expect(acceptResponse.body.data.accessToken).toEqual(expect.any(String));

      const persisted = await prisma.user.findUniqueOrThrow({
        where: { email: 'newstaff@salon.com' },
      });
      expect(persisted.tenantId).toBe(owner.tenantId);
      expect(persisted.isEmailVerified).toBe(true);

      const invitation = await prisma.tenantInvitation.findFirstOrThrow({
        where: { email: 'newstaff@salon.com' },
      });
      expect(invitation.acceptedAt).not.toBeNull();

      // A second acceptance attempt with the same (now-consumed) token fails.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invitation')
        .send({
          token: rawToken,
          firstName: 'New',
          lastName: 'Staff',
          password: 'Str0ngP@ss1',
        })
        .expect(400);
      expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_INVITATION');
    } finally {
      await prisma.user
        .deleteMany({ where: { email: 'newstaff@salon.com' } })
        .catch(() => {});
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
