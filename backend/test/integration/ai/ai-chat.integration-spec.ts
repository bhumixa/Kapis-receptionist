import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';
import {
  seedConversation,
  seedCustomer,
  seedWhatsAppAccount,
} from '../support/whatsapp-fixtures';
import { seedBookableSetup } from '../support/scheduling-fixtures';
import { createAiTestApp, ScriptedLlmProvider } from '../support/ai-fixtures';
import { LlmProviderUnavailableException } from '../../../src/modules/ai/infrastructure/openai-llm.provider';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('POST /api/v1/ai/chat (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: ScriptedLlmProvider;
  let internalApiKey: string;

  beforeAll(async () => {
    const created = await createAiTestApp();
    app = created.app;
    llm = created.llm;
    prisma = getPrisma(app);
    // Populated into process.env as a side effect of ConfigModule.forRoot
    // (same precedent test/integration/whatsapp/webhooks.integration-spec.ts
    // already established for WHATSAPP_APP_SECRET).
    internalApiKey = process.env.AI_INTERNAL_API_KEY as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('dashboard_test mode answers a grounded FAQ without persisting any Message row', async () => {
    const owner = await seedOwner(app, 'ai-chat-faq');
    try {
      const token = await login(app, owner.email, owner.password);
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15550002222',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      llm.enqueueReply("We're open every day from 9 to 5.");

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId: conversation.id,
          message: 'What are your hours?',
          channel: 'dashboard_test',
        })
        .expect(200);

      expect(response.body.data.replyText).toBe(
        "We're open every day from 9 to 5.",
      );
      expect(response.body.data.meta.degraded).toBe(false);

      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
      });
      expect(messages).toHaveLength(0);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects dashboard_test mode for a STAFF-role JWT (MANAGER floor required)', async () => {
    const staff = await seedStaff(app, 'ai-chat-staff');
    try {
      const token = await login(app, staff.email, staff.password);

      await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'hello', channel: 'dashboard_test' })
        .expect(403);
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });

  it('channel: "whatsapp" via internal-service credential books a real appointment through the full tool-calling loop', async () => {
    const owner = await seedOwner(app, 'ai-chat-book');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15550003333',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const startTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      startTime.setUTCHours(14, 0, 0, 0);

      llm
        .enqueueToolCall('bookAppointment', {
          startTime: startTime.toISOString(),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .enqueueReply("You're all booked in!");

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', owner.tenantId)
        .send({
          conversationId: conversation.id,
          message: 'Book me a haircut Saturday at 2pm.',
          channel: 'whatsapp',
        })
        .expect(200);

      expect(response.body.data.replyText).toBe("You're all booked in!");
      expect(response.body.data.toolCallsExecuted).toHaveLength(1);
      expect(response.body.data.toolCallsExecuted[0].tool).toBe(
        'bookAppointment',
      );

      const appointment = await prisma.appointment.findFirst({
        where: { tenantId: owner.tenantId, customerId: customer.id },
      });
      expect(appointment).not.toBeNull();

      const history = await prisma.appointmentStatusHistory.findFirst({
        where: { tenantId: owner.tenantId, appointmentId: appointment!.id },
      });
      expect(history?.actorType).toBe(ActorType.AI);
      expect(history?.actorId).toBeNull();

      const aiMessage = await prisma.message.findFirst({
        where: { conversationId: conversation.id, senderType: ActorType.AI },
      });
      expect(aiMessage).not.toBeNull();
      expect(aiMessage?.content).toBe("You're all booked in!");
      expect(aiMessage?.aiPromptVersion).toBe('system-prompt@v1');

      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          tenantId: owner.tenantId,
          action: 'APPOINTMENT_CREATED',
          actorType: ActorType.AI,
        },
      });
      expect(auditEntry).not.toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a hallucinated serviceId gracefully — no appointment created, no raw error surfaced', async () => {
    const owner = await seedOwner(app, 'ai-chat-hallucinate');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15550004444',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      llm
        .enqueueToolCall('bookAppointment', {
          startTime: new Date(Date.now() + 86400000).toISOString(),
          services: [{ serviceId: randomUUID(), employeeId: randomUUID() }],
        })
        .enqueueReply(
          "I couldn't find that service — could you tell me which one you'd like?",
        );

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', owner.tenantId)
        .send({
          conversationId: conversation.id,
          message: 'Book me the thing.',
          channel: 'whatsapp',
        })
        .expect(200);

      expect(response.body.data.replyText).toContain("couldn't find");
      expect(response.body.data.toolCallsExecuted[0].result).toHaveProperty(
        'error',
      );

      const appointment = await prisma.appointment.findFirst({
        where: { tenantId: owner.tenantId, customerId: customer.id },
      });
      expect(appointment).toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects an internal-service call with a missing X-Internal-Api-Key header', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ai/chat')
      .set('X-Tenant-Id', randomUUID())
      .send({
        conversationId: randomUUID(),
        message: 'hi',
        channel: 'whatsapp',
      })
      .expect(401);
  });

  it('falls back gracefully and auto-escalates when the LLM provider fails', async () => {
    const owner = await seedOwner(app, 'ai-chat-fallback');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15550005555',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      llm.enqueueRejection(
        new LlmProviderUnavailableException(
          new Error('simulated provider outage'),
        ),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', owner.tenantId)
        .send({
          conversationId: conversation.id,
          message: 'hello?',
          channel: 'whatsapp',
        })
        .expect(200);

      expect(response.body.data.meta.degraded).toBe(true);

      const updated = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(updated.status).toBe('ESCALATED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
