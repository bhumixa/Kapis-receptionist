import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';
import {
  seedConversation,
  seedCustomer,
  seedWhatsAppAccount,
} from '../support/whatsapp-fixtures';
import { seedBookableSetup } from '../support/scheduling-fixtures';
import { createAiTestApp, ScriptedLlmProvider } from '../support/ai-fixtures';

/**
 * docs/adr/ADR-011-ai-receptionist.md's tenant-isolation acceptance
 * criterion, made concrete over real HTTP: an AI call scoped to tenant A
 * (via `X-Tenant-Id`) must never read or mutate tenant B's data under any
 * tool, even when a plausible-looking id for tenant B's row is supplied
 * directly in the request body — exactly the shape a hallucinated or
 * maliciously-crafted tool-call argument could take.
 */
describe('AI tenant isolation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: ScriptedLlmProvider;
  let internalApiKey: string;

  beforeAll(async () => {
    const created = await createAiTestApp();
    app = created.app;
    llm = created.llm;
    prisma = getPrisma(app);
    internalApiKey = process.env.AI_INTERNAL_API_KEY as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /ai/tools/book rejects a customerId that belongs to a different tenant', async () => {
    const tenantA = await seedOwner(app, 'iso-a-book');
    const tenantB = await seedOwner(app, 'iso-b-book');
    try {
      const setup = await seedBookableSetup(prisma, tenantA.tenantId);
      const customerB = await seedCustomer(
        prisma,
        tenantB.tenantId,
        '+15556660001',
      );
      const conversationA = await seedConversation(prisma, tenantA.tenantId, {
        customerId: (
          await seedCustomer(prisma, tenantA.tenantId, '+15556660002')
        ).id,
        whatsappAccountId: (await seedWhatsAppAccount(prisma, tenantA.tenantId))
          .id,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/tools/book')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', tenantA.tenantId)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId: customerB.id, // belongs to tenant B, not tenant A
          startTime: new Date(Date.now() + 86400000).toISOString(),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
          conversationId: conversationA.id,
          actorType: 'AI',
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INVALID_CUSTOMER_REFERENCE');

      const leaked = await prisma.appointment.findFirst({
        where: { tenantId: tenantB.tenantId, customerId: customerB.id },
      });
      expect(leaked).toBeNull();
    } finally {
      await cleanupTenant(prisma, tenantA.tenantId);
      await cleanupTenant(prisma, tenantB.tenantId);
    }
  });

  it('POST /ai/tools/cancel returns 404 (never leaks existence) for an appointment belonging to a different tenant', async () => {
    const tenantA = await seedOwner(app, 'iso-a-cancel');
    const tenantB = await seedOwner(app, 'iso-b-cancel');
    try {
      const setupB = await seedBookableSetup(prisma, tenantB.tenantId);
      const customerB = await seedCustomer(
        prisma,
        tenantB.tenantId,
        '+15556660003',
      );
      const appointmentB = await prisma.appointment.create({
        data: {
          tenantId: tenantB.tenantId,
          customerId: customerB.id,
          employeeId: setupB.employeeId,
          startTime: new Date(Date.now() + 86400000),
          endTime: new Date(Date.now() + 86400000 + 45 * 60000),
          totalPriceCents: 8000,
          currency: 'USD',
        },
      });

      const customerA = await seedCustomer(
        prisma,
        tenantA.tenantId,
        '+15556660004',
      );
      const accountA = await seedWhatsAppAccount(prisma, tenantA.tenantId);
      const conversationA = await seedConversation(prisma, tenantA.tenantId, {
        customerId: customerA.id,
        whatsappAccountId: accountA.id,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/tools/cancel')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', tenantA.tenantId)
        .set('Idempotency-Key', randomUUID())
        .send({
          appointmentId: appointmentB.id,
          conversationId: conversationA.id,
          actorType: 'AI',
        });

      expect(response.status).toBe(404);

      const stillActive = await prisma.appointment.findUnique({
        where: { id: appointmentB.id },
      });
      expect(stillActive?.status).toBe('CONFIRMED');
    } finally {
      await cleanupTenant(prisma, tenantA.tenantId);
      await cleanupTenant(prisma, tenantB.tenantId);
    }
  });

  it('a full chat turn for tenant A never surfaces tenant B data even when the model asks a cross-tenant question', async () => {
    const tenantA = await seedOwner(app, 'iso-a-chat');
    const tenantB = await seedOwner(app, 'iso-b-chat');
    try {
      await seedBookableSetup(prisma, tenantB.tenantId);
      const accountA = await seedWhatsAppAccount(prisma, tenantA.tenantId);
      const customerA = await seedCustomer(
        prisma,
        tenantA.tenantId,
        '+15556660005',
      );
      const conversationA = await seedConversation(prisma, tenantA.tenantId, {
        customerId: customerA.id,
        whatsappAccountId: accountA.id,
      });

      llm.enqueueReply('We only have the services listed for your salon.');

      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', tenantA.tenantId)
        .send({
          conversationId: conversationA.id,
          message: 'What services do you offer?',
          channel: 'whatsapp',
        })
        .expect(200);

      expect(response.body.data.conversationId).toBe(conversationA.id);
    } finally {
      await cleanupTenant(prisma, tenantA.tenantId);
      await cleanupTenant(prisma, tenantB.tenantId);
    }
  });
});
