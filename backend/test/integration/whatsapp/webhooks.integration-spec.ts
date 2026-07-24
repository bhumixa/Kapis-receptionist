import { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';
import { seedWhatsAppAccount, waitFor } from '../support/whatsapp-fixtures';

function sign(secret: string, body: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function textMessagePayload(
  whatsappPhoneNumberId: string,
  messageId: string,
  from: string,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: whatsappPhoneNumberId },
              contacts: [{ wa_id: from, profile: { name: 'Test Customer' } }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  type: 'text',
                  text: { body: 'Hi, is Saturday available?' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('POST/GET /webhooks/whatsapp (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let appSecret: string;
  let verifyToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    // Populated into process.env as a side effect of ConfigModule.forRoot
    // parsing `.env` during app bootstrap above.
    appSecret = process.env.WHATSAPP_APP_SECRET as string;
    verifyToken = process.env.WHATSAPP_VERIFY_TOKEN as string;
    expect(appSecret).toBeTruthy();
    expect(verifyToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes the challenge on a correct verification handshake', async () => {
    const response = await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': 'challenge-xyz',
      })
      .expect(200);
    expect(response.text).toBe('challenge-xyz');
  });

  it('rejects a verification handshake with the wrong verify token', async () => {
    await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-xyz',
      })
      .expect(401);
  });

  it('rejects a POST with a missing/invalid signature and still logs the raw WebhookEvent', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [] };
    const rawBody = Buffer.from(JSON.stringify(payload));

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=0000000000000000')
      .send(payload)
      .expect(401);

    const event = await waitFor(() =>
      prisma.webhookEvent.findFirst({
        where: {
          signatureValid: false,
          eventType: 'whatsapp_business_account',
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(event?.signatureValid).toBe(false);
    void rawBody;
  });

  it('accepts a correctly signed inbound message and persists it as a Message within an OPEN Conversation', async () => {
    const owner = await seedOwner(app, 'wa-webhook');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId, {
        connectionStatus: 'CONNECTED' as never,
      });
      const messageId = `wamid.${randomUUID()}`;
      const from = '+15559990001';
      const payload = textMessagePayload(
        account.whatsappPhoneNumberId,
        messageId,
        from,
      );
      const rawBody = Buffer.from(JSON.stringify(payload));

      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(appSecret, rawBody))
        .send(payload)
        .expect(200);

      const message = await waitFor(() =>
        prisma.message.findFirst({ where: { whatsappMessageId: messageId } }),
      );
      expect(message).toMatchObject({
        direction: 'INBOUND',
        content: 'Hi, is Saturday available?',
        tenantId: owner.tenantId,
      });

      const conversation = await prisma.conversation.findUnique({
        where: { id: message.conversationId },
      });
      expect(conversation?.status).toBe('OPEN');
      expect(conversation?.whatsappAccountId).toBe(account.id);

      const customer = await prisma.customer.findFirst({
        where: { tenantId: owner.tenantId, phoneNumber: from },
      });
      expect(customer).not.toBeNull();
      expect(customer?.firstName).toBe('Test Customer');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('is idempotent under a webhook replay: sending the identical signed payload twice creates exactly one Message', async () => {
    const owner = await seedOwner(app, 'wa-replay');
    try {
      const account = await seedWhatsAppAccount(prisma, owner.tenantId, {
        connectionStatus: 'CONNECTED' as never,
      });
      const messageId = `wamid.${randomUUID()}`;
      const payload = textMessagePayload(
        account.whatsappPhoneNumberId,
        messageId,
        '+15559990002',
      );
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = sign(appSecret, rawBody);

      // First delivery.
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200);

      await waitFor(() =>
        prisma.message.findFirst({ where: { whatsappMessageId: messageId } }),
      );

      // Meta's at-least-once redelivery of the exact same webhook body.
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200);

      // Give the second delivery's async processing a moment to (not) create a duplicate.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const count = await prisma.message.count({
        where: { whatsappMessageId: messageId },
      });
      expect(count).toBe(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('drops an inbound event whose phone_number_id matches no tenant, without creating cross-tenant data', async () => {
    const messageId = `wamid.${randomUUID()}`;
    const payload = textMessagePayload(
      'no-such-phone-number-id',
      messageId,
      '+15559990003',
    );
    const rawBody = Buffer.from(JSON.stringify(payload));

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(appSecret, rawBody))
      .send(payload)
      .expect(200);

    const event = await waitFor(async () => {
      const row = await prisma.webhookEvent.findFirst({
        where: { whatsappMessageId: messageId },
        orderBy: { createdAt: 'desc' },
      });
      // Wait for the async BullMQ job to actually finish processing, not
      // just for the synchronously-persisted PENDING row to exist.
      return row?.processingStatus !== 'PENDING' ? row : null;
    });
    expect(event?.processingStatus).toBe('PROCESSED');
    expect(event?.tenantId).toBeNull();

    const message = await prisma.message.findFirst({
      where: { whatsappMessageId: messageId },
    });
    expect(message).toBeNull();
  });
});
