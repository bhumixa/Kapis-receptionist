import { ActorType, ConversationStatus, RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { ConversationsService } from '../../../src/modules/whatsapp/application/conversations.service';
import { ConversationRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/conversation-repository.port';
import { ConversationEntity } from '../../../src/modules/whatsapp/domain/entities/conversation.entity';

const ownerActor = {
  sub: 'user-owner',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
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
    lastMessageAt: new Date('2026-07-24T10:00:00Z'),
    lastInboundMessageAt: new Date('2026-07-24T10:00:00Z'),
    escalatedAt: null,
    escalationReason: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ConversationsService', () => {
  let repo: jest.Mocked<ConversationRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: ConversationsService;

  beforeEach(() => {
    repo = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findMostRecentOpenByCustomer: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      assignUser: jest.fn(),
      escalate: jest.fn(),
      touchLastMessage: jest.fn(),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ConversationsService(
      repo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('getConversation', () => {
    it('returns the conversation when found for the tenant', async () => {
      const conversation = makeConversation();
      repo.findByIdForTenant.mockResolvedValue(conversation);

      const result = await service.getConversation(
        'tenant-1',
        'conversation-1',
      );

      expect(result).toEqual(conversation);
      expect(repo.findByIdForTenant).toHaveBeenCalledWith(
        'tenant-1',
        'conversation-1',
      );
    });

    it('throws TenantResourceNotFoundException when not found', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.getConversation('tenant-1', 'missing'),
      ).rejects.toThrow(TenantResourceNotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status and records an audit log entry', async () => {
      const current = makeConversation({ status: ConversationStatus.OPEN });
      const updated = makeConversation({ status: ConversationStatus.RESOLVED });
      repo.findByIdForTenant.mockResolvedValue(current);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await service.updateStatus(
        'tenant-1',
        'conversation-1',
        ownerActor,
        ConversationStatus.RESOLVED,
      );

      expect(result.status).toBe(ConversationStatus.RESOLVED);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONVERSATION_STATUS_CHANGED',
          metadata: {
            from: ConversationStatus.OPEN,
            to: ConversationStatus.RESOLVED,
          },
        }),
      );
    });

    it('throws TenantResourceNotFoundException when the conversation does not exist', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'tenant-1',
          'missing',
          ownerActor,
          ConversationStatus.CLOSED,
        ),
      ).rejects.toThrow(TenantResourceNotFoundException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('findOrCreateOpenConversation', () => {
    it('returns the existing open conversation for the customer when one exists', async () => {
      const existing = makeConversation();
      repo.findMostRecentOpenByCustomer.mockResolvedValue(existing);

      const result = await service.findOrCreateOpenConversation(
        'tenant-1',
        'customer-1',
        'account-1',
      );

      expect(result).toEqual(existing);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates a new conversation when no open one exists', async () => {
      repo.findMostRecentOpenByCustomer.mockResolvedValue(null);
      const created = makeConversation();
      repo.create.mockResolvedValue(created);

      const result = await service.findOrCreateOpenConversation(
        'tenant-1',
        'customer-1',
        'account-1',
      );

      expect(result).toEqual(created);
      expect(repo.create).toHaveBeenCalledWith('tenant-1', {
        customerId: 'customer-1',
        whatsappAccountId: 'account-1',
      });
    });
  });

  describe('touchLastMessage', () => {
    it('delegates to the repository', async () => {
      const now = new Date();
      await service.touchLastMessage('tenant-1', 'conversation-1', now, true);
      expect(repo.touchLastMessage).toHaveBeenCalledWith(
        'tenant-1',
        'conversation-1',
        now,
        true,
      );
    });
  });

  // Milestone 8 (docs/adr/ADR-011-ai-receptionist.md): the `escalateToHuman`
  // tool target.
  describe('escalateConversation', () => {
    it('moves the conversation to ESCALATED and records an AI-attributed audit entry', async () => {
      const current = makeConversation({ status: ConversationStatus.OPEN });
      const escalated = makeConversation({
        status: ConversationStatus.ESCALATED,
        escalationReason: 'Customer asked for a human.',
      });
      repo.findByIdForTenant.mockResolvedValue(current);
      repo.escalate.mockResolvedValue(escalated);

      const result = await service.escalateConversation(
        'tenant-1',
        'conversation-1',
        'Customer asked for a human.',
        ActorType.AI,
      );

      expect(result.status).toBe(ConversationStatus.ESCALATED);
      expect(repo.escalate).toHaveBeenCalledWith(
        'tenant-1',
        'conversation-1',
        'Customer asked for a human.',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONVERSATION_ESCALATED',
          actorType: ActorType.AI,
          actorId: null,
          metadata: {
            reason: 'Customer asked for a human.',
            from: ConversationStatus.OPEN,
          },
        }),
      );
    });

    it('also accepts ActorType.SYSTEM for the provider-outage fallback path', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeConversation());
      repo.escalate.mockResolvedValue(
        makeConversation({ status: ConversationStatus.ESCALATED }),
      );

      await service.escalateConversation(
        'tenant-1',
        'conversation-1',
        'AI provider unavailable.',
        ActorType.SYSTEM,
      );

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: ActorType.SYSTEM }),
      );
    });

    it('throws TenantResourceNotFoundException when the conversation does not exist', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.escalateConversation(
          'tenant-1',
          'missing',
          'reason',
          ActorType.AI,
        ),
      ).rejects.toThrow(TenantResourceNotFoundException);
      expect(repo.escalate).not.toHaveBeenCalled();
    });
  });
});
