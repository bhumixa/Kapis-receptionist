import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { WebhookProcessingStatus } from '@prisma/client';
import { WebhookIngestionService } from '../../../src/modules/whatsapp/application/webhook-ingestion.service';
import { WebhookEventRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/webhook-event-repository.port';
import {
  InvalidVerifyTokenException,
  InvalidWebhookSignatureException,
} from '../../../src/modules/whatsapp/application/exceptions/whatsapp.exceptions';
import { WebhookEventEntity } from '../../../src/modules/whatsapp/domain/entities/webhook-event.entity';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

function makeConfigService(): ConfigService {
  const values: Record<string, string> = {
    'whatsapp.appSecret': APP_SECRET,
    'whatsapp.verifyToken': VERIFY_TOKEN,
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeWebhookEvent(
  overrides: Partial<WebhookEventEntity> = {},
): WebhookEventEntity {
  return {
    id: 'event-1',
    tenantId: null,
    whatsappMessageId: null,
    eventType: 'messages',
    payload: {},
    signatureValid: true,
    processingStatus: WebhookProcessingStatus.PENDING,
    processedAt: null,
    errorMessage: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('WebhookIngestionService', () => {
  let webhookEvents: jest.Mocked<WebhookEventRepositoryPort>;
  let inboundQueue: { add: jest.Mock };
  let service: WebhookIngestionService;

  beforeEach(() => {
    webhookEvents = {
      create: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    inboundQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new WebhookIngestionService(
      webhookEvents,
      inboundQueue as never,
      makeConfigService(),
    );
  });

  describe('handleVerification', () => {
    it('returns the challenge when mode and token are correct', () => {
      const result = service.handleVerification(
        'subscribe',
        VERIFY_TOKEN,
        'challenge-123',
      );
      expect(result).toBe('challenge-123');
    });

    it('throws InvalidVerifyTokenException on a wrong token', () => {
      expect(() =>
        service.handleVerification('subscribe', 'wrong-token', 'challenge'),
      ).toThrow(InvalidVerifyTokenException);
    });

    it('throws InvalidVerifyTokenException on a wrong mode', () => {
      expect(() =>
        service.handleVerification('unsubscribe', VERIFY_TOKEN, 'challenge'),
      ).toThrow(InvalidVerifyTokenException);
    });
  });

  describe('ingest', () => {
    it('persists the event and enqueues processing for a validly signed payload', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '123' },
                  messages: [{ id: 'wamid.ABC' }],
                },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const header = sign(rawBody);
      webhookEvents.create.mockResolvedValue(
        makeWebhookEvent({ whatsappMessageId: 'wamid.ABC' }),
      );

      await service.ingest(rawBody, header);

      expect(webhookEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          signatureValid: true,
          whatsappMessageId: 'wamid.ABC',
          eventType: 'messages',
        }),
      );
      expect(inboundQueue.add).toHaveBeenCalledWith(
        'process-webhook-event',
        { webhookEventId: 'event-1' },
        expect.objectContaining({ attempts: 5 }),
      );
    });

    it('persists the event but rejects and does not enqueue when the signature is invalid', async () => {
      const rawBody = Buffer.from(JSON.stringify({ object: 'test' }));
      webhookEvents.create.mockResolvedValue(
        makeWebhookEvent({ signatureValid: false }),
      );

      await expect(
        service.ingest(rawBody, 'sha256=not-a-valid-signature'),
      ).rejects.toThrow(InvalidWebhookSignatureException);

      expect(webhookEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({ signatureValid: false }),
      );
      expect(inboundQueue.add).not.toHaveBeenCalled();
    });

    it('persists the raw payload even when the body is not valid JSON', async () => {
      const rawBody = Buffer.from('not json at all');
      const header = sign(rawBody);
      webhookEvents.create.mockResolvedValue(makeWebhookEvent());

      await service.ingest(rawBody, header);

      expect(webhookEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({ signatureValid: true, payload: {} }),
      );
    });
  });
});
