import {
  Conversation as PrismaConversation,
  Message as PrismaMessage,
  WebhookEvent as PrismaWebhookEvent,
  WhatsAppAccount as PrismaWhatsAppAccount,
} from '@prisma/client';
import { WhatsAppAccountEntity } from '../../domain/entities/whatsapp-account.entity';
import { ConversationEntity } from '../../domain/entities/conversation.entity';
import { MessageEntity } from '../../domain/entities/message.entity';
import { WebhookEventEntity } from '../../domain/entities/webhook-event.entity';

export function toWhatsAppAccountEntity(
  row: PrismaWhatsAppAccount,
): WhatsAppAccountEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneNumber: row.phoneNumber,
    whatsappPhoneNumberId: row.whatsappPhoneNumberId,
    whatsappBusinessAccountId: row.whatsappBusinessAccountId,
    accessTokenEncrypted: row.accessTokenEncrypted,
    connectionStatus: row.connectionStatus,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    lastHealthCheckAt: row.lastHealthCheckAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toConversationEntity(
  row: PrismaConversation,
): ConversationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    whatsappAccountId: row.whatsappAccountId,
    status: row.status,
    assignedUserId: row.assignedUserId,
    lastMessageAt: row.lastMessageAt,
    lastInboundMessageAt: row.lastInboundMessageAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMessageEntity(row: PrismaMessage): MessageEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    direction: row.direction,
    senderType: row.senderType,
    senderId: row.senderId,
    messageType: row.messageType,
    content: row.content,
    mediaWhatsappId: row.mediaWhatsappId,
    mediaMimeType: row.mediaMimeType,
    mediaSha256: row.mediaSha256,
    mediaFilename: row.mediaFilename,
    mediaSizeBytes: row.mediaSizeBytes,
    whatsappMessageId: row.whatsappMessageId,
    status: row.status,
    failureReason: row.failureReason,
    sourceWebhookEventId: row.sourceWebhookEventId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toWebhookEventEntity(
  row: PrismaWebhookEvent,
): WebhookEventEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    whatsappMessageId: row.whatsappMessageId,
    eventType: row.eventType,
    payload: row.payload,
    signatureValid: row.signatureValid,
    processingStatus: row.processingStatus,
    processedAt: row.processedAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}
