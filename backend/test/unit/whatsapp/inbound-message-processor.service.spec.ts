import {
  ActorType,
  ConversationStatus,
  MessageDeliveryStatus,
  MessageType,
  WebhookProcessingStatus,
} from '@prisma/client';
import { InboundMessageProcessorService } from '../../../src/modules/whatsapp/application/inbound-message-processor.service';
import { WebhookEventRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/webhook-event-repository.port';
import { WhatsAppAccountRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/whatsapp-account-repository.port';
import { MessageRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/message-repository.port';
import { ConversationsService } from '../../../src/modules/whatsapp/application/conversations.service';
import { CustomerService } from '../../../src/modules/customers/application/customer.service';
import { RedisService } from '../../../src/database/redis.service';
import { WebhookEventEntity } from '../../../src/modules/whatsapp/domain/entities/webhook-event.entity';
import { WhatsAppAccountEntity } from '../../../src/modules/whatsapp/domain/entities/whatsapp-account.entity';
import { ConversationEntity } from '../../../src/modules/whatsapp/domain/entities/conversation.entity';

function makeAccount(): WhatsAppAccountEntity {
  return {
    id: 'account-1',
    tenantId: 'tenant-1',
    phoneNumber: '+15550001111',
    whatsappPhoneNumberId: 'phone-number-id-123',
    whatsappBusinessAccountId: 'business-account-1',
    accessTokenEncrypted: 'encrypted',
    connectionStatus: 'CONNECTED',
    connectedAt: new Date(),
    disconnectedAt: null,
    lastHealthCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeConversation(): ConversationEntity {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    whatsappAccountId: 'account-1',
    status: ConversationStatus.OPEN,
    assignedUserId: null,
    lastMessageAt: null,
    lastInboundMessageAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeWebhookEvent(payload: unknown): WebhookEventEntity {
  return {
    id: 'event-1',
    tenantId: null,
    whatsappMessageId: null,
    eventType: 'messages',
    payload,
    signatureValid: true,
    processingStatus: WebhookProcessingStatus.PENDING,
    processedAt: null,
    errorMessage: null,
    createdAt: new Date(),
  };
}

function textMessagePayload(messageId: string, from = '+15559998888') {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'phone-number-id-123' },
              contacts: [{ wa_id: from, profile: { name: 'Sofia' } }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: '1721000000',
                  type: 'text',
                  text: { body: 'Hi, do you have availability Saturday?' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('InboundMessageProcessorService', () => {
  let webhookEvents: jest.Mocked<WebhookEventRepositoryPort>;
  let whatsappAccounts: jest.Mocked<WhatsAppAccountRepositoryPort>;
  let messages: jest.Mocked<MessageRepositoryPort>;
  let conversationsService: jest.Mocked<
    Pick<
      ConversationsService,
      'findOrCreateOpenConversation' | 'touchLastMessage'
    >
  >;
  let customerService: jest.Mocked<
    Pick<CustomerService, 'findOrCreateByPhoneForTenant'>
  >;
  let redis: jest.Mocked<Pick<RedisService, 'set'>>;
  let processor: InboundMessageProcessorService;

  beforeEach(() => {
    webhookEvents = {
      create: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    whatsappAccounts = {
      findByTenantId: jest.fn(),
      findByPhoneNumberId: jest.fn().mockResolvedValue(makeAccount()),
      create: jest.fn(),
      updateConnectionStatus: jest.fn(),
    };
    messages = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByWhatsappMessageId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'message-1' }),
      updateStatus: jest.fn(),
      updateStatusByWhatsappMessageId: jest.fn(),
      setWhatsappMessageId: jest.fn(),
    };
    conversationsService = {
      findOrCreateOpenConversation: jest
        .fn()
        .mockResolvedValue(makeConversation()),
      touchLastMessage: jest.fn().mockResolvedValue(undefined),
    };
    customerService = {
      findOrCreateByPhoneForTenant: jest
        .fn()
        .mockResolvedValue({ id: 'customer-1' }),
    };
    redis = { set: jest.fn().mockResolvedValue('OK') };

    processor = new InboundMessageProcessorService(
      webhookEvents,
      whatsappAccounts,
      messages,
      conversationsService as unknown as ConversationsService,
      customerService as unknown as CustomerService,
      redis as unknown as RedisService,
    );
  });

  it('does nothing when the webhook event cannot be found', async () => {
    webhookEvents.findById.mockResolvedValue(null);

    await processor.process('missing-event');

    expect(whatsappAccounts.findByPhoneNumberId).not.toHaveBeenCalled();
  });

  it('processes a text message: resolves tenant, syncs contact, creates conversation and message', async () => {
    const payload = textMessagePayload('wamid.ONE');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));

    await processor.process('event-1');

    expect(whatsappAccounts.findByPhoneNumberId).toHaveBeenCalledWith(
      'phone-number-id-123',
    );
    expect(customerService.findOrCreateByPhoneForTenant).toHaveBeenCalledWith(
      'tenant-1',
      '+15559998888',
      'Sofia',
    );
    expect(
      conversationsService.findOrCreateOpenConversation,
    ).toHaveBeenCalledWith('tenant-1', 'customer-1', 'account-1');
    expect(messages.create).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        conversationId: 'conversation-1',
        direction: 'INBOUND',
        senderType: ActorType.CUSTOMER,
        messageType: MessageType.TEXT,
        content: 'Hi, do you have availability Saturday?',
        whatsappMessageId: 'wamid.ONE',
        status: MessageDeliveryStatus.DELIVERED,
      }),
    );
    expect(conversationsService.touchLastMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      expect.any(Date),
      true,
    );
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      WebhookProcessingStatus.PROCESSED,
      { tenantId: 'tenant-1' },
    );
  });

  it('is idempotent via the Redis dedup key: a duplicate message is not persisted twice', async () => {
    const payload = textMessagePayload('wamid.DUPLICATE');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));
    redis.set.mockResolvedValue(null); // key already exists -> dedup hit

    await processor.process('event-1');

    expect(messages.create).not.toHaveBeenCalled();
    expect(customerService.findOrCreateByPhoneForTenant).not.toHaveBeenCalled();
  });

  it('is idempotent via the DB backstop when Redis has no record of the message (cold cache)', async () => {
    const payload = textMessagePayload('wamid.ALREADY-IN-DB');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));
    redis.set.mockResolvedValue('OK'); // Redis thinks it's new
    messages.findByWhatsappMessageId.mockResolvedValue({
      id: 'existing-message',
    } as never); // but DB already has it

    await processor.process('event-1');

    expect(messages.create).not.toHaveBeenCalled();
  });

  it('handles a webhook replay (same payload processed twice) without creating duplicate messages', async () => {
    const payload = textMessagePayload('wamid.REPLAYED');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));

    await processor.process('event-1');
    expect(messages.create).toHaveBeenCalledTimes(1);

    // Simulate Meta redelivering the exact same webhook as a new WebhookEvent row.
    redis.set.mockResolvedValue(null);
    await processor.process('event-1');

    expect(messages.create).toHaveBeenCalledTimes(1);
  });

  it('drops the change and continues when phone_number_id matches no known account', async () => {
    whatsappAccounts.findByPhoneNumberId.mockResolvedValue(null);
    const payload = textMessagePayload('wamid.UNKNOWN-ACCOUNT');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));

    await processor.process('event-1');

    expect(messages.create).not.toHaveBeenCalled();
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      WebhookProcessingStatus.PROCESSED,
      undefined,
    );
  });

  it('updates message delivery status for a status-update webhook', async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'phone-number-id-123' },
                statuses: [{ id: 'wamid.OUT-1', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));

    await processor.process('event-1');

    expect(messages.updateStatusByWhatsappMessageId).toHaveBeenCalledWith(
      'wamid.OUT-1',
      MessageDeliveryStatus.DELIVERED,
    );
  });

  it('marks the webhook event FAILED and rethrows on an unexpected processing error', async () => {
    const payload = textMessagePayload('wamid.ERROR-CASE');
    webhookEvents.findById.mockResolvedValue(makeWebhookEvent(payload));
    messages.create.mockRejectedValue(new Error('db exploded'));
    messages.findByWhatsappMessageId.mockResolvedValue(null);

    await expect(processor.process('event-1')).rejects.toThrow('db exploded');

    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      WebhookProcessingStatus.FAILED,
      { errorMessage: 'db exploded' },
    );
  });
});
