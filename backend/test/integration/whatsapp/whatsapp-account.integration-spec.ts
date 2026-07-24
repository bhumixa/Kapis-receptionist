import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';
import { seedWhatsAppAccount } from '../support/whatsapp-fixtures';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('GET/POST/DELETE /api/v1/whatsapp/account (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns null when no account is connected yet', async () => {
    const owner = await seedOwner(app, 'wa-account-none');
    try {
      const token = await login(app, owner.email, owner.password);
      const response = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.data).toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('STAFF cannot connect or disconnect an account (whatsapp:manage required)', async () => {
    const owner = await seedOwner(app, 'wa-account-staff-owner');
    const staff = await seedStaff(app, 'wa-account-staff');
    try {
      await prisma.user.update({
        where: { id: staff.userId },
        data: { tenantId: owner.tenantId },
      });
      const staffToken = await login(app, staff.email, staff.password);

      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          phoneNumber: '+15550009999',
          whatsappPhoneNumberId: 'irrelevant',
          whatsappBusinessAccountId: 'irrelevant',
          accessToken: 'irrelevant-token-value',
        })
        .expect(403);

      await request(app.getHttpServer())
        .delete('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('translates a Meta credential rejection into 400 INVALID_WHATSAPP_CREDENTIALS', async () => {
    const owner = await seedOwner(app, 'wa-account-bad-creds');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${token}`)
        .send({
          phoneNumber: '+15550009999',
          whatsappPhoneNumberId: 'definitely-not-a-real-phone-number-id',
          whatsappBusinessAccountId: 'definitely-not-real',
          accessToken: 'definitely-not-a-real-access-token',
        })
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_WHATSAPP_CREDENTIALS');

      const account = await prisma.whatsAppAccount.findUnique({
        where: { tenantId: owner.tenantId },
      });
      expect(account).toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  }, 15000);

  it('rejects connecting a second account for the same tenant with 409', async () => {
    const owner = await seedOwner(app, 'wa-account-dupe');
    try {
      const token = await login(app, owner.email, owner.password);
      await seedWhatsAppAccount(prisma, owner.tenantId, {
        connectionStatus: 'CONNECTED' as never,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${token}`)
        .send({
          phoneNumber: '+15550009999',
          whatsappPhoneNumberId: 'another-phone-number-id',
          whatsappBusinessAccountId: 'another-business-account',
          accessToken: 'another-access-token-value',
        })
        .expect(409);
      expect(response.body.error.code).toBe('ACCOUNT_ALREADY_CONNECTED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('disconnects a connected account and records an audit entry', async () => {
    const owner = await seedOwner(app, 'wa-account-disconnect');
    try {
      const token = await login(app, owner.email, owner.password);
      await seedWhatsAppAccount(prisma, owner.tenantId, {
        connectionStatus: 'CONNECTED' as never,
      });

      const response = await request(app.getHttpServer())
        .delete('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.data.connectionStatus).toBe('DISCONNECTED');

      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          tenantId: owner.tenantId,
          action: 'WHATSAPP_ACCOUNT_DISCONNECTED',
        },
      });
      expect(auditEntry).not.toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('returns 400 ACCOUNT_NOT_CONNECTED when disconnecting with nothing connected', async () => {
    const owner = await seedOwner(app, 'wa-account-disconnect-none');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .delete('/api/v1/whatsapp/account')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_CONNECTED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
