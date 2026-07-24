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

export interface SendAiMessageInput {
  conversationId: string;
  body: string;
  promptVersion: string | null;
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
    this.assertWithinMessagingWindow(conversation);

    const message = await this.messages.create(tenantId, {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: ActorType.USER,
      senderId: actor.sub,
      messageType: MessageType.TEXT,
      content: input.body,
      status: MessageDeliveryStatus.QUEUED,
    });

    await this.enqueueOutbound(tenantId, message.id);

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

  /**
   * AI-orchestration sibling of `sendMessage` (docs/adr/
   * ADR-011-ai-receptionist.md) — persists with `senderType: AI` instead of
   * `USER`, no `AccessTokenPayload`/`Idempotency-Key` (the caller is the
   * in-process orchestrator, not an HTTP client retrying a request), and
   * records `aiPromptVersion` for SYSTEM_ARCHITECTURE.md 5.6's traceability
   * requirement. Reuses the exact same 24-hour-messaging-window check
   * `sendMessage` enforces — an AI reply is bound by the same Meta
   * compliance rule as a manual staff reply, never a bypass.
   */
  async sendAiMessage(
    tenantId: string,
    input: SendAiMessageInput,
  ): Promise<MessageEntity> {
    const conversation = await this.conversations.findByIdForTenant(
      tenantId,
      input.conversationId,
    );
    if (!conversation) {
      throw new TenantResourceNotFoundException();
    }
    this.assertWithinMessagingWindow(conversation);

    const message = await this.messages.create(tenantId, {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: ActorType.AI,
      senderId: null,
      messageType: MessageType.TEXT,
      content: input.body,
      status: MessageDeliveryStatus.QUEUED,
      aiPromptVersion: input.promptVersion,
    });

    await this.enqueueOutbound(tenantId, message.id);

    await this.auditLog.record({
      action: 'AI_MESSAGE_SEND_QUEUED',
      entityType: 'Message',
      entityId: message.id,
      actorType: ActorType.AI,
      actorId: null,
      tenantId,
      metadata: {
        conversationId: input.conversationId,
        promptVersion: input.promptVersion,
      },
    });

    return message;
  }

  private assertWithinMessagingWindow(conversation: {
    lastInboundMessageAt: Date | null;
  }): void {
    if (
      !conversation.lastInboundMessageAt ||
      Date.now() - conversation.lastInboundMessageAt.getTime() >
        MESSAGING_WINDOW_MS
    ) {
      throw new OutsideMessagingWindowException();
    }
  }

  private async enqueueOutbound(
    tenantId: string,
    messageId: string,
  ): Promise<void> {
    await this.outboundQueue.add(
      'send-message',
      { tenantId, messageId },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
