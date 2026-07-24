import {
  ActorType,
  ConversationStatus,
  MessageDeliveryStatus,
  MessageType,
  RoleName,
} from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { MessagesService } from '../../../src/modules/whatsapp/application/messages.service';
import { OutsideMessagingWindowException } from '../../../src/modules/whatsapp/application/exceptions/whatsapp.exceptions';
import { MessageRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/message-repository.port';
import { ConversationRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/conversation-repository.port';
import { ConversationEntity } from '../../../src/modules/whatsapp/domain/entities/conversation.entity';
import { MessageEntity } from '../../../src/modules/whatsapp/domain/entities/message.entity';

const staffActor = {
  sub: 'user-staff',
  email: 'staff@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.STAFF],
};

function makeConversation(
  overrides: Partial<ConversationEntity> = {},
): ConversationEntity {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    whatsappAccountId: 'account-1',
    status: ConversationStatus.OPEN,
    assignedUserId: null,
    lastMessageAt: new Date(),
    lastInboundMessageAt: new Date(),
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MessageEntity> = {}): MessageEntity {
  return {
    id: 'message-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    direction: 'OUTBOUND',
    senderType: ActorType.USER,
    senderId: 'user-staff',
    messageType: MessageType.TEXT,
    content: 'hello',
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

describe('MessagesService', () => {
  let messages: jest.Mocked<MessageRepositoryPort>;
  let conversations: jest.Mocked<ConversationRepositoryPort>;
  let outboundQueue: { add: jest.Mock };
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: MessagesService;

  beforeEach(() => {
    messages = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByWhatsappMessageId: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      updateStatusByWhatsappMessageId: jest.fn(),
      setWhatsappMessageId: jest.fn(),
    };
    conversations = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findMostRecentOpenByCustomer: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      assignUser: jest.fn(),
      touchLastMessage: jest.fn(),
    };
    outboundQueue = { add: jest.fn().mockResolvedValue(undefined) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new MessagesService(
      messages,
      conversations,
      outboundQueue as never,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('sendMessage', () => {
    it('creates a QUEUED message and enqueues an outbound job within the 24h window', async () => {
      const conversation = makeConversation({
        lastInboundMessageAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      conversations.findByIdForTenant.mockResolvedValue(conversation);
      const created = makeMessage();
      messages.create.mockResolvedValue(created);

      const result = await service.sendMessage('tenant-1', staffActor, {
        conversationId: 'conversation-1',
        body: 'hello',
      });

      expect(result).toEqual(created);
      expect(messages.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          conversationId: 'conversation-1',
          direction: 'OUTBOUND',
          content: 'hello',
          status: MessageDeliveryStatus.QUEUED,
        }),
      );
      expect(outboundQueue.add).toHaveBeenCalledWith(
        'send-message',
        { tenantId: 'tenant-1', messageId: created.id },
        expect.objectContaining({ attempts: 5 }),
      );
      expect(auditLog.record).toHaveBeenCalled();
    });

    it('rejects with OutsideMessagingWindowException past 24 hours since last inbound message', async () => {
      const conversation = makeConversation({
        lastInboundMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      conversations.findByIdForTenant.mockResolvedValue(conversation);

      await expect(
        service.sendMessage('tenant-1', staffActor, {
          conversationId: 'conversation-1',
          body: 'hello',
        }),
      ).rejects.toThrow(OutsideMessagingWindowException);
      expect(messages.create).not.toHaveBeenCalled();
      expect(outboundQueue.add).not.toHaveBeenCalled();
    });

    it('rejects when the conversation has never received an inbound message', async () => {
      const conversation = makeConversation({ lastInboundMessageAt: null });
      conversations.findByIdForTenant.mockResolvedValue(conversation);

      await expect(
        service.sendMessage('tenant-1', staffActor, {
          conversationId: 'conversation-1',
          body: 'hello',
        }),
      ).rejects.toThrow(OutsideMessagingWindowException);
    });

    it('throws TenantResourceNotFoundException when the conversation does not exist', async () => {
      conversations.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.sendMessage('tenant-1', staffActor, {
          conversationId: 'missing',
          body: 'hello',
        }),
      ).rejects.toThrow(TenantResourceNotFoundException);
    });

    it('rejects right at the 24h boundary (23h59m59s is allowed, 24h00m01s is not)', async () => {
      const justInside = makeConversation({
        lastInboundMessageAt: new Date(
          Date.now() - (24 * 60 * 60 * 1000 - 1000),
        ),
      });
      conversations.findByIdForTenant.mockResolvedValue(justInside);
      messages.create.mockResolvedValue(makeMessage());

      await expect(
        service.sendMessage('tenant-1', staffActor, {
          conversationId: 'conversation-1',
          body: 'hi',
        }),
      ).resolves.toBeDefined();

      const justOutside = makeConversation({
        lastInboundMessageAt: new Date(
          Date.now() - (24 * 60 * 60 * 1000 + 1000),
        ),
      });
      conversations.findByIdForTenant.mockResolvedValue(justOutside);

      await expect(
        service.sendMessage('tenant-1', staffActor, {
          conversationId: 'conversation-1',
          body: 'hi',
        }),
      ).rejects.toThrow(OutsideMessagingWindowException);
    });
  });

  describe('listMessages', () => {
    it('throws TenantResourceNotFoundException when the conversation does not exist', async () => {
      conversations.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.listMessages('tenant-1', 'missing', {
          sortDirection: 'asc',
          cursor: null,
          limit: 50,
        }),
      ).rejects.toThrow(TenantResourceNotFoundException);
    });

    it('lists messages for an existing conversation', async () => {
      conversations.findByIdForTenant.mockResolvedValue(makeConversation());
      messages.findList.mockResolvedValue([makeMessage()]);

      const result = await service.listMessages('tenant-1', 'conversation-1', {
        sortDirection: 'asc',
        cursor: null,
        limit: 50,
      });

      expect(result).toHaveLength(1);
      expect(messages.findList).toHaveBeenCalledWith('tenant-1', {
        sortDirection: 'asc',
        cursor: null,
        limit: 50,
        conversationId: 'conversation-1',
      });
    });
  });
});
