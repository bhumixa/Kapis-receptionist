import { ActorType, MessageDeliveryStatus, MessageType } from '@prisma/client';
import type { CursorPayload } from '../../../../common/utils/cursor-pagination.util';
import { MessageEntity } from '../entities/message.entity';

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface CreateMessageInput {
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: ActorType;
  senderId?: string | null;
  messageType: MessageType;
  content?: string | null;
  mediaWhatsappId?: string | null;
  mediaMimeType?: string | null;
  mediaSha256?: string | null;
  mediaFilename?: string | null;
  mediaSizeBytes?: number | null;
  whatsappMessageId?: string | null;
  status: MessageDeliveryStatus;
  sourceWebhookEventId?: string | null;
}

export interface MessageListFilter {
  conversationId: string;
  sortDirection: 'asc' | 'desc';
  cursor: CursorPayload | null;
  limit: number;
}

export interface MessageRepositoryPort {
  findList(
    tenantId: string,
    filter: MessageListFilter,
  ): Promise<MessageEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<MessageEntity | null>;
  /**
   * Global lookup (no `tenantId` filter) — the database-level idempotency
   * backstop behind the partial-unique index on `whatsappMessageId`, used
   * by the inbound processor before insert and by delivery-status webhook
   * handling to find the message a receipt refers to.
   */
  findByWhatsappMessageId(
    whatsappMessageId: string,
  ): Promise<MessageEntity | null>;
  create(tenantId: string, input: CreateMessageInput): Promise<MessageEntity>;
  updateStatus(
    tenantId: string,
    id: string,
    status: MessageDeliveryStatus,
    failureReason?: string | null,
  ): Promise<MessageEntity>;
  /** Delivery/read-receipt webhooks identify the message by `whatsappMessageId`, not `id`. */
  updateStatusByWhatsappMessageId(
    whatsappMessageId: string,
    status: MessageDeliveryStatus,
  ): Promise<void>;
  setWhatsappMessageId(
    tenantId: string,
    id: string,
    whatsappMessageId: string,
  ): Promise<void>;
}
