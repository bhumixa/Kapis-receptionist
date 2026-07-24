import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ActorType, MessageDeliveryStatus, MessageType } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { MessageEntity } from '../domain/entities/message.entity';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepositoryPort,
} from '../domain/ports/conversation-repository.port';
import {
  MESSAGE_REPOSITORY,
  type MessageListFilter,
  type MessageRepositoryPort,
} from '../domain/ports/message-repository.port';
import { OutsideMessagingWindowException } from './exceptions/whatsapp.exceptions';
import { WHATSAPP_OUTBOUND_QUEUE } from '../queues/whatsapp-queue.constants';

/** Meta's customer-service-messaging window (API_SPECIFICATION.md Section 11). */
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SendMessageInput {
  conversationId: string;
  body: string;
}

/**
 * `GET /messages`, `POST /messages/send` (API_SPECIFICATION.md Section 11)
 * — open to STAFF, matching the existing appointments/customers pattern:
 * replying to a customer is normal front-desk work.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messages: MessageRepositoryPort,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepositoryPort,
    @InjectQueue(WHATSAPP_OUTBOUND_QUEUE)
    private readonly outboundQueue: Queue,
    private readonly auditLog: AuditLogService,
  ) {}

  async listMessages(
    tenantId: string,
    conversationId: string,
    filter: Omit<MessageListFilter, 'conversationId'>,
  ): Promise<MessageEntity[]> {
    const conversation = await this.conversations.findByIdForTenant(
      tenantId,
      conversationId,
    );
    if (!conversation) {
      throw new TenantResourceNotFoundException();
    }
    return this.messages.findList(tenantId, { ...filter, conversationId });
  }

  /**
   * Staff manual reply. Enqueues onto the outbound BullMQ queue rather than
   * calling Meta inline — `202 Accepted` from the controller reflects this:
   * queued, not yet confirmed delivered (SYSTEM_ARCHITECTURE.md Section
   * 6.3). No `TemplateMessage` fallback outside the 24h window (deliberately
   * deferred, docs/adr/ADR-010-whatsapp-platform.md) — rejected outright.
   */
  async sendMessage(
    tenantId: string,
    actor: AccessTokenPayload,
    input: SendMessageInput,
  ): Promise<MessageEntity> {
    const conversation = await this.conversations.findByIdForTenant(
      tenantId,
      input.conversationId,
    );
    if (!conversation) {
      throw new TenantResourceNotFoundException();
    }

    if (
      !conversation.lastInboundMessageAt ||
      Date.now() - conversation.lastInboundMessageAt.getTime() >
        MESSAGING_WINDOW_MS
    ) {
      throw new OutsideMessagingWindowException();
    }

    const message = await this.messages.create(tenantId, {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: ActorType.USER,
      senderId: actor.sub,
      messageType: MessageType.TEXT,
      content: input.body,
      status: MessageDeliveryStatus.QUEUED,
    });

    await this.outboundQueue.add(
      'send-message',
      { tenantId, messageId: message.id },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.auditLog.record({
      action: 'WHATSAPP_MESSAGE_SEND_QUEUED',
      entityType: 'Message',
      entityId: message.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { conversationId: input.conversationId },
    });

    return message;
  }
}
