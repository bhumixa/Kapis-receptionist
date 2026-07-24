import { Inject, Injectable } from '@nestjs/common';
import { ActorType, ConversationStatus } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { ConversationEntity } from '../domain/entities/conversation.entity';
import {
  CONVERSATION_REPOSITORY,
  type ConversationListFilter,
  type ConversationRepositoryPort,
} from '../domain/ports/conversation-repository.port';

/**
 * `GET /conversations[/:id]`, `PATCH /conversations/:id`
 * (API_SPECIFICATION.md Section 11) — open to STAFF (read + reply-adjacent
 * status changes are normal front-desk work, not an owner/manager-only
 * action, matching the existing `appointments`/`customers` read pattern).
 */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listConversations(
    tenantId: string,
    filter: ConversationListFilter,
  ): Promise<ConversationEntity[]> {
    return this.conversations.findList(tenantId, filter);
  }

  async getConversation(
    tenantId: string,
    id: string,
  ): Promise<ConversationEntity> {
    const conversation = await this.conversations.findByIdForTenant(
      tenantId,
      id,
    );
    if (!conversation) {
      throw new TenantResourceNotFoundException();
    }
    return conversation;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    status: ConversationStatus,
  ): Promise<ConversationEntity> {
    const current = await this.conversations.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    const updated = await this.conversations.updateStatus(tenantId, id, status);

    await this.auditLog.record({
      action: 'CONVERSATION_STATUS_CHANGED',
      entityType: 'Conversation',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { from: current.status, to: status },
    });

    return updated;
  }

  async assignUser(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    userId: string | null,
  ): Promise<ConversationEntity> {
    const current = await this.conversations.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    const updated = await this.conversations.assignUser(tenantId, id, userId);

    await this.auditLog.record({
      action: 'CONVERSATION_ASSIGNED',
      entityType: 'Conversation',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { assignedUserId: userId },
    });

    return updated;
  }

  /**
   * The "current open thread" resolution (DATABASE_DESIGN.md) — used by
   * `InboundMessageProcessorService` to decide whether an inbound message
   * belongs to an existing open conversation or starts a new one.
   */
  async findOrCreateOpenConversation(
    tenantId: string,
    customerId: string,
    whatsappAccountId: string,
  ): Promise<ConversationEntity> {
    const existing = await this.conversations.findMostRecentOpenByCustomer(
      tenantId,
      customerId,
    );
    if (existing) {
      return existing;
    }
    return this.conversations.create(tenantId, {
      customerId,
      whatsappAccountId,
    });
  }

  /** Used by `InboundMessageProcessorService`/`OutboundMessageService` after persisting a message. */
  async touchLastMessage(
    tenantId: string,
    conversationId: string,
    occurredAt: Date,
    isInbound: boolean,
  ): Promise<void> {
    await this.conversations.touchLastMessage(
      tenantId,
      conversationId,
      occurredAt,
      isInbound,
    );
  }
}
