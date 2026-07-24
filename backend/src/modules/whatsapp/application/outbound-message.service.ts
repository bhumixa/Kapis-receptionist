import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActorType, MessageDeliveryStatus } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { CustomerService } from '../../customers/application/customer.service';
import {
  WhatsAppCloudApiClient,
  WhatsAppCloudApiError,
} from '../infrastructure/whatsapp-cloud-api.client';
import { ConversationsService } from './conversations.service';
import { WhatsAppAccountService } from './whatsapp-account.service';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepositoryPort,
} from '../domain/ports/conversation-repository.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../domain/ports/message-repository.port';

/**
 * The business logic behind `whatsapp-outbound` BullMQ jobs
 * (`queues/whatsapp-outbound.processor.ts` is the thin BullMQ adapter).
 * Transient Cloud API failures (5xx/429) are rethrown so BullMQ's
 * configured backoff retries the job (SYSTEM_ARCHITECTURE.md Section 6.5);
 * permanent failures (4xx) are terminal — the message is marked `FAILED`
 * and surfaced to staff, never silently retried indefinitely.
 */
@Injectable()
export class OutboundMessageService {
  private readonly logger = new Logger(OutboundMessageService.name);

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messages: MessageRepositoryPort,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepositoryPort,
    private readonly conversationsService: ConversationsService,
    private readonly customerService: CustomerService,
    private readonly whatsappAccountService: WhatsAppAccountService,
    private readonly cloudApiClient: WhatsAppCloudApiClient,
    private readonly auditLog: AuditLogService,
  ) {}

  async send(tenantId: string, messageId: string): Promise<void> {
    const message = await this.messages.findByIdForTenant(tenantId, messageId);
    if (!message) {
      this.logger.warn(
        `Message ${messageId} not found for tenant ${tenantId} — skipping`,
      );
      return;
    }

    const conversation = await this.conversations.findByIdForTenant(
      tenantId,
      message.conversationId,
    );
    if (!conversation) {
      this.logger.warn(
        `Conversation ${message.conversationId} not found — marking message ${messageId} FAILED`,
      );
      await this.messages.updateStatus(
        tenantId,
        messageId,
        MessageDeliveryStatus.FAILED,
        'Conversation not found',
      );
      return;
    }

    const customer = await this.customerService.getCustomer(
      tenantId,
      conversation.customerId,
    );
    const account =
      await this.whatsappAccountService.getSendableAccount(tenantId);

    try {
      const result = await this.cloudApiClient.sendTextMessage(
        account.accessToken,
        account.whatsappPhoneNumberId,
        customer.phoneNumber,
        message.content ?? '',
      );

      await this.messages.setWhatsappMessageId(
        tenantId,
        messageId,
        result.whatsappMessageId,
      );
      await this.messages.updateStatus(
        tenantId,
        messageId,
        MessageDeliveryStatus.SENT,
      );
      await this.conversationsService.touchLastMessage(
        tenantId,
        conversation.id,
        new Date(),
        false,
      );
    } catch (error) {
      if (error instanceof WhatsAppCloudApiError && !error.isTransient) {
        await this.messages.updateStatus(
          tenantId,
          messageId,
          MessageDeliveryStatus.FAILED,
          error.message,
        );
        await this.auditLog.record({
          action: 'WHATSAPP_MESSAGE_SEND_FAILED',
          entityType: 'Message',
          entityId: messageId,
          actorType: ActorType.SYSTEM,
          tenantId,
          metadata: { statusCode: error.statusCode, reason: error.message },
        });
        return;
      }
      // Transient (5xx/429) or unexpected — rethrow so BullMQ retries with backoff.
      throw error;
    }
  }

  /** Called by the outbound processor's `failed` worker event once BullMQ's retry attempts are exhausted. */
  async markPermanentlyFailed(
    tenantId: string,
    messageId: string,
    reason: string,
  ): Promise<void> {
    await this.messages.updateStatus(
      tenantId,
      messageId,
      MessageDeliveryStatus.FAILED,
      reason,
    );
    await this.auditLog.record({
      action: 'WHATSAPP_MESSAGE_SEND_FAILED',
      entityType: 'Message',
      entityId: messageId,
      actorType: ActorType.SYSTEM,
      tenantId,
      metadata: { reason, retriesExhausted: true },
    });
  }
}
