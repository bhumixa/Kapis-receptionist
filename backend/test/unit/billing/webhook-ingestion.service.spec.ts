import { WebhookProcessingStatus } from '@prisma/client';
import { WebhookIngestionService } from '../../../src/modules/billing/application/webhook-ingestion.service';
import { InvalidStripeWebhookSignatureException } from '../../../src/modules/billing/application/exceptions/billing.exceptions';
import { WebhookLogEntity } from '../../../src/modules/billing/domain/entities/webhook-log.entity';
import { WebhookLogRepositoryPort } from '../../../src/modules/billing/domain/ports/webhook-log-repository.port';
import { StripeClient } from '../../../src/modules/billing/infrastructure/stripe-client';
import { RedisService } from '../../../src/database/redis.service';

function makeWebhookLog(
  overrides: Partial<WebhookLogEntity> = {},
): WebhookLogEntity {
  return {
    id: 'log-1',
    provider: 'STRIPE',
    providerEventId: 'evt_123',
    eventType: 'customer.subscription.updated',
    payload: {},
    tenantId: null,
    processingStatus: WebhookProcessingStatus.PENDING,
    processedAt: null,
    errorMessage: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('WebhookIngestionService (Stripe)', () => {
  let webhookLogs: jest.Mocked<WebhookLogRepositoryPort>;
  let stripeWebhookQueue: { add: jest.Mock };
  let stripeClient: jest.Mocked<Pick<StripeClient, 'constructWebhookEvent'>>;
  let redis: jest.Mocked<Pick<RedisService, 'set'>>;
  let service: WebhookIngestionService;

  beforeEach(() => {
    webhookLogs = {
      create: jest.fn(),
      findByProviderEventId: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    stripeWebhookQueue = { add: jest.fn().mockResolvedValue(undefined) };
    stripeClient = { constructWebhookEvent: jest.fn() };
    redis = { set: jest.fn().mockResolvedValue('OK') };

    service = new WebhookIngestionService(
      webhookLogs,
      stripeWebhookQueue as never,
      stripeClient as unknown as StripeClient,
      redis as unknown as RedisService,
    );
  });

  it('persists and enqueues a validly signed event', async () => {
    stripeClient.constructWebhookEvent.mockReturnValue({
      id: 'evt_123',
      type: 'customer.subscription.updated',
    } as never);
    webhookLogs.findByProviderEventId.mockResolvedValue(null);
    webhookLogs.create.mockResolvedValue(makeWebhookLog());

    await service.ingest(Buffer.from('{}'), 'valid-signature');

    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'STRIPE',
        providerEventId: 'evt_123',
        eventType: 'customer.subscription.updated',
      }),
    );
    expect(stripeWebhookQueue.add).toHaveBeenCalledWith(
      'process-stripe-webhook-event',
      { webhookLogId: 'log-1' },
      expect.objectContaining({ attempts: 5 }),
    );
  });

  it('persists a synthetic record and throws when signature verification fails', async () => {
    stripeClient.constructWebhookEvent.mockImplementation(() => {
      throw new Error('signature mismatch');
    });
    webhookLogs.create.mockResolvedValue(makeWebhookLog());

    await expect(
      service.ingest(Buffer.from('{}'), 'bad-signature'),
    ).rejects.toThrow(InvalidStripeWebhookSignatureException);

    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'STRIPE',
        eventType: 'unknown',
      }),
    );
    expect(stripeWebhookQueue.add).not.toHaveBeenCalled();
  });

  it('skips processing (Redis dedup) when the same event id was already seen', async () => {
    stripeClient.constructWebhookEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'invoice.paid',
    } as never);
    redis.set.mockResolvedValue(null);

    await service.ingest(Buffer.from('{}'), 'valid-signature');

    expect(webhookLogs.create).not.toHaveBeenCalled();
    expect(stripeWebhookQueue.add).not.toHaveBeenCalled();
  });

  it('skips processing (DB backstop) when Redis missed but the row already exists', async () => {
    stripeClient.constructWebhookEvent.mockReturnValue({
      id: 'evt_dup2',
      type: 'invoice.paid',
    } as never);
    webhookLogs.findByProviderEventId.mockResolvedValue(makeWebhookLog());

    await service.ingest(Buffer.from('{}'), 'valid-signature');

    expect(webhookLogs.create).not.toHaveBeenCalled();
    expect(stripeWebhookQueue.add).not.toHaveBeenCalled();
  });
});
