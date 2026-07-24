import {
  ActorType,
  ConversationStatus,
  MessageDeliveryStatus,
  MessageType,
} from '@prisma/client';
import { OutboundMessageService } from '../../../src/modules/whatsapp/application/outbound-message.service';
import {
  WhatsAppCloudApiClient,
  WhatsAppCloudApiError,
} from '../../../src/modules/whatsapp/infrastructure/whatsapp-cloud-api.client';
import { ConversationsService } from '../../../src/modules/whatsapp/application/conversations.service';
import { WhatsAppAccountService } from '../../../src/modules/whatsapp/application/whatsapp-account.service';
import { CustomerService } from '../../../src/modules/customers/application/customer.service';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { MessageRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/message-repository.port';
import { ConversationRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/conversation-repository.port';
import { MessageEntity } from '../../../src/modules/whatsapp/domain/entities/message.entity';
import { ConversationEntity } from '../../../src/modules/whatsapp/domain/entities/conversation.entity';

function makeMessage(overrides: Partial<MessageEntity> = {}): MessageEntity {
  return {
    id: 'message-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    direction: 'OUTBOUND',
    senderType: ActorType.USER,
    senderId: 'user-1',
    messageType: MessageType.TEXT,
    content: 'Your appointment is confirmed.',
    mediaWhatsappId: null,
    mediaMimeType: null,
    mediaSha256: null,
    mediaFilename: null,
    mediaSizeBytes: null,
    whatsappMessageId: null,
    status: MessageDeliveryStatus.QUEUED,
    failureReason: null,
    sourceWebhookEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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
    lastInboundMessageAt: new Date(),
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('OutboundMessageService', () => {
  let messages: jest.Mocked<MessageRepositoryPort>;
  let conversations: jest.Mocked<ConversationRepositoryPort>;
  let conversationsService: jest.Mocked<
    Pick<ConversationsService, 'touchLastMessage'>
  >;
  let customerService: jest.Mocked<Pick<CustomerService, 'getCustomer'>>;
  let whatsappAccountService: jest.Mocked<
    Pick<WhatsAppAccountService, 'getSendableAccount'>
  >;
  let cloudApiClient: jest.Mocked<
    Pick<WhatsAppCloudApiClient, 'sendTextMessage'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: OutboundMessageService;

  beforeEach(() => {
    messages = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn().mockResolvedValue(makeMessage()),
      findByWhatsappMessageId: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateStatusByWhatsappMessageId: jest.fn(),
      setWhatsappMessageId: jest.fn().mockResolvedValue(undefined),
    };
    conversations = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn().mockResolvedValue(makeConversation()),
      findMostRecentOpenByCustomer: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      assignUser: jest.fn(),
      touchLastMessage: jest.fn(),
    };
    conversationsService = {
      touchLastMessage: jest.fn().mockResolvedValue(undefined),
    };
    customerService = {
      getCustomer: jest
        .fn()
        .mockResolvedValue({ id: 'customer-1', phoneNumber: '+15559998888' }),
    };
    whatsappAccountService = {
      getSendableAccount: jest.fn().mockResolvedValue({
        whatsappPhoneNumberId: 'phone-number-id-123',
        accessToken: 'decrypted-token',
      }),
    };
    cloudApiClient = { sendTextMessage: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new OutboundMessageService(
      messages,
      conversations,
      conversationsService as unknown as ConversationsService,
      customerService as unknown as CustomerService,
      whatsappAccountService as unknown as WhatsAppAccountService,
      cloudApiClient as unknown as WhatsAppCloudApiClient,
      auditLog as unknown as AuditLogService,
    );
  });

  it('sends successfully: sets whatsappMessageId, marks SENT, and touches the conversation', async () => {
    cloudApiClient.sendTextMessage.mockResolvedValue({
      whatsappMessageId: 'wamid.SENT-1',
    });

    await service.send('tenant-1', 'message-1');

    expect(cloudApiClient.sendTextMessage).toHaveBeenCalledWith(
      'decrypted-token',
      'phone-number-id-123',
      '+15559998888',
      'Your appointment is confirmed.',
    );
    expect(messages.setWhatsappMessageId).toHaveBeenCalledWith(
      'tenant-1',
      'message-1',
      'wamid.SENT-1',
    );
    expect(messages.updateStatus).toHaveBeenCalledWith(
      'tenant-1',
      'message-1',
      MessageDeliveryStatus.SENT,
    );
    expect(conversationsService.touchLastMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      expect.any(Date),
      false,
    );
  });

  it('marks the message FAILED (no retry) on a permanent 4xx Cloud API error', async () => {
    cloudApiClient.sendTextMessage.mockRejectedValue(
      new WhatsAppCloudApiError('Invalid recipient', 400, {}),
    );

    await service.send('tenant-1', 'message-1');

    expect(messages.updateStatus).toHaveBeenCalledWith(
      'tenant-1',
      'message-1',
      MessageDeliveryStatus.FAILED,
      'Invalid recipient',
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_MESSAGE_SEND_FAILED' }),
    );
  });

  it('rethrows on a transient 5xx Cloud API error so BullMQ retries', async () => {
    cloudApiClient.sendTextMessage.mockRejectedValue(
      new WhatsAppCloudApiError('Service unavailable', 503, {}),
    );

    await expect(service.send('tenant-1', 'message-1')).rejects.toThrow(
      WhatsAppCloudApiError,
    );
    expect(messages.updateStatus).not.toHaveBeenCalled();
  });

  it('rethrows on a 429 rate-limit error so BullMQ retries', async () => {
    cloudApiClient.sendTextMessage.mockRejectedValue(
      new WhatsAppCloudApiError('Rate limited', 429, {}),
    );

    await expect(service.send('tenant-1', 'message-1')).rejects.toThrow(
      WhatsAppCloudApiError,
    );
    expect(messages.updateStatus).not.toHaveBeenCalled();
  });

  it('marks a message FAILED when the conversation no longer exists, without calling the Cloud API', async () => {
    conversations.findByIdForTenant.mockResolvedValue(null);

    await service.send('tenant-1', 'message-1');

    expect(cloudApiClient.sendTextMessage).not.toHaveBeenCalled();
    expect(messages.updateStatus).toHaveBeenCalledWith(
      'tenant-1',
      'message-1',
      MessageDeliveryStatus.FAILED,
      'Conversation not found',
    );
  });

  describe('markPermanentlyFailed', () => {
    it('marks the message FAILED and audit-logs after retries are exhausted', async () => {
      await service.markPermanentlyFailed(
        'tenant-1',
        'message-1',
        'Retries exhausted',
      );

      expect(messages.updateStatus).toHaveBeenCalledWith(
        'tenant-1',
        'message-1',
        MessageDeliveryStatus.FAILED,
        'Retries exhausted',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WHATSAPP_MESSAGE_SEND_FAILED' }),
      );
      const call = auditLog.record.mock.calls[0][0];
      expect(call.metadata).toEqual(
        expect.objectContaining({ retriesExhausted: true }),
      );
    });
  });
});
