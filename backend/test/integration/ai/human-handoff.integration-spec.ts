import { INestApplication } from '@nestjs/common';
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
import { createAiTestApp, ScriptedLlmProvider } from '../support/ai-fixtures';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

/**
 * SYSTEM_ARCHITECTURE.md 5.8's human hand-off, end to end: the AI escalates
 * mid-conversation, the conversation surfaces in the STAFF-visible
 * `ESCALATED` queue, and a staff member can claim it via the new
 * `PATCH /conversations/:id/assign` endpoint (docs/adr/
 * ADR-011-ai-receptionist.md).
 */
describe('Human handoff (integration)', () => {
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

  it('escalates the conversation, surfaces it in the ESCALATED queue, and lets staff take it over', async () => {
    const owner = await seedOwner(app, 'handoff-owner');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId);
      const customer = await seedCustomer(
        prisma,
        owner.tenantId,
        '+15557770001',
      );
      const conversation = await seedConversation(prisma, owner.tenantId, {
        customerId: customer.id,
        whatsappAccountId: account.id,
      });

      llm
        .enqueueToolCall('escalateToHuman', {
          reason: 'Customer explicitly asked for a manager.',
        })
        .enqueueReply("I'm connecting you with our team now.");

      await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('X-Internal-Api-Key', internalApiKey)
        .set('X-Tenant-Id', owner.tenantId)
        .send({
          conversationId: conversation.id,
          message: 'I want to speak to your manager right now.',
          channel: 'whatsapp',
        })
        .expect(200);

      const escalated = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(escalated.status).toBe('ESCALATED');
      expect(escalated.escalationReason).toBe(
        'Customer explicitly asked for a manager.',
      );
      expect(escalated.escalatedAt).not.toBeNull();

      const ownerToken = await login(app, owner.email, owner.password);

      const queue = await request(app.getHttpServer())
        .get('/api/v1/conversations?status=ESCALATED')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(queue.body.data.map((c: { id: string }) => c.id)).toContain(
        conversation.id,
      );

      // Claiming the conversation for oneself (a real STAFF/OWNER/MANAGER
      // action, matching this API's existing STAFF-broad convention for
      // reply-adjacent conversation actions) — `assignedUserId` has no
      // composite-tenant-safe FK (a pre-existing schema gap, not this
      // milestone's to fix), so the test deliberately only ever assigns a
      // user within the *same* tenant as the conversation.
      const claimed = await request(app.getHttpServer())
        .patch(`/api/v1/conversations/${conversation.id}/assign`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: owner.userId })
        .expect(200);
      expect(claimed.body.data.assignedUserId).toBe(owner.userId);
      // Status stays ESCALATED — assignment (claimed/unclaimed) and status
      // are deliberately orthogonal (docs/adr/ADR-011-ai-receptionist.md's
      // narrowing rationale: no separate HUMAN_HANDLING state).
      expect(claimed.body.data.status).toBe('ESCALATED');

      const unassigned = await request(app.getHttpServer())
        .patch(`/api/v1/conversations/${conversation.id}/assign`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: null })
        .expect(200);
      expect(unassigned.body.data.assignedUserId).toBeNull();
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
