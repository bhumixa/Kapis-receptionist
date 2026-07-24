import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';
import {
  seedConversation,
  seedCustomer,
  seedWhatsAppAccount,
} from '../support/whatsapp-fixtures';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('GET/PATCH /api/v1/conversations, GET/POST /api/v1/messages (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists conversations scoped to the caller tenant, fetches one, and updates its status', async () => {
    const owner = await seedOwner(app, 'conv-crud');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110001',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      const list = await request(app.getHttpServer())
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toContain(
        conversation.id,
      );
      expect(list.body.meta.pagination).toBeDefined();

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.data.status).toBe('OPEN');

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'RESOLVED' })
        .expect(200);
      expect(updated.body.data.status).toBe('RESOLVED');

      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          tenantId: owner.tenantId,
          entityType: 'Conversation',
          action: 'CONVERSATION_STATUS_CHANGED',
        },
      });
      expect(auditEntry).not.toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects an unknown status value with a validation error', async () => {
    const owner = await seedOwner(app, 'conv-badstatus');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110002',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'NOT_A_REAL_STATUS' })
        .expect(422);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("enforces tenant isolation: tenant B cannot read or modify tenant A's conversation", async () => {
    const ownerA = await seedOwner(app, 'conv-tenant-a');
    const ownerB = await seedOwner(app, 'conv-tenant-b');
    try {
      const accountA = await seedWhatsAppAccount(prisma, ownerA.tenantId);
      const customerA = await seedCustomer(
        prisma,
        ownerA.tenantId,
        '+15551110003',
      );
      const conversationA = await seedConversation(prisma, ownerA.tenantId, {
        customerId: customerA.id,
        whatsappAccountId: accountA.id,
      });

      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/conversations/${conversationA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ status: 'CLOSED' })
        .expect(404);

      const listB = await request(app.getHttpServer())
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(
        listB.body.data.some((c: { id: string }) => c.id === conversationA.id),
      ).toBe(false);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('lists messages for a conversation in ascending order and requires conversationId', async () => {
    const owner = await seedOwner(app, 'msg-list');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110004',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      await prisma.message.create({
        data: {
          tenantId: owner.tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          messageType: 'TEXT',
          content: 'First message',
          status: 'DELIVERED',
        },
      });
      await prisma.message.create({
        data: {
          tenantId: owner.tenantId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          senderType: 'USER',
          senderId: owner.userId,
          messageType: 'TEXT',
          content: 'Second message',
          status: 'SENT',
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/messages')
        .query({ conversationId: conversation.id })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        response.body.data.map((m: { content: string }) => m.content),
      ).toEqual(['First message', 'Second message']);

      await request(app.getHttpServer())
        .get('/api/v1/messages')
        .set('Authorization', `Bearer ${token}`)
        .expect(422);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('POST /messages/send queues a message (202) when within the 24h window, and is idempotent under a repeated Idempotency-Key', async () => {
    const owner = await seedOwner(app, 'msg-send');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110005',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
        lastInboundMessageAt: new Date(),
      });

      const idempotencyKey = randomUUID();
      const first = await request(app.getHttpServer())
        .post('/api/v1/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ conversationId: conversation.id, body: 'Hello there!' })
        .expect(202);
      expect(first.body.data.status).toBe('QUEUED');
      expect(first.body.data.content).toBe('Hello there!');

      const messageCountAfterFirst = await prisma.message.count({
        where: { conversationId: conversation.id },
      });
      expect(messageCountAfterFirst).toBe(1);

      const second = await request(app.getHttpServer())
        .post('/api/v1/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ conversationId: conversation.id, body: 'Hello there!' })
        .expect(202);
      expect(second.body.data.id).toBe(first.body.data.id);

      const messageCountAfterReplay = await prisma.message.count({
        where: { conversationId: conversation.id },
      });
      expect(messageCountAfterReplay).toBe(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('POST /messages/send rejects with 422 OUTSIDE_MESSAGING_WINDOW past the 24h customer-service window', async () => {
    const owner = await seedOwner(app, 'msg-window');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110006',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
        lastInboundMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ conversationId: conversation.id, body: 'Too late!' })
        .expect(422);
      expect(response.body.error.code).toBe('OUTSIDE_MESSAGING_WINDOW');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('allows STAFF to read and reply to conversations (no whatsapp:manage permission required)', async () => {
    const owner = await seedOwner(app, 'msg-staff-owner');
    const staff = await seedStaff(app, 'msg-staff');
    try {
      // Point the staff user at the owner's tenant so they share a
      // WhatsApp-connected tenant (seedStaff creates its own separate
      // tenant by default) — align tenants directly via Prisma.
      await prisma.user.update({
        where: { id: staff.userId },
        data: { tenantId: owner.tenantId },
      });
      const staffToken = await login(app, staff.email, staff.password);

      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15551110007',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
        lastInboundMessageAt: new Date(),
      });

      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/messages/send')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ conversationId: conversation.id, body: 'Staff reply' })
        .expect(202);
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
