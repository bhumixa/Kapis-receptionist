import { WhatsAppAccountEntity } from '../../domain/entities/whatsapp-account.entity';
import { ConversationEntity } from '../../domain/entities/conversation.entity';
import { MessageEntity } from '../../domain/entities/message.entity';
import { WhatsAppAccountResponseDto } from '../dto/whatsapp-account-response.dto';
import { ConversationResponseDto } from '../dto/conversation-response.dto';
import { MessageResponseDto } from '../dto/message-response.dto';

export function toWhatsAppAccountResponseDto(
  entity: WhatsAppAccountEntity,
): WhatsAppAccountResponseDto {
  return {
    id: entity.id,
    phoneNumber: entity.phoneNumber,
    whatsappPhoneNumberId: entity.whatsappPhoneNumberId,
    whatsappBusinessAccountId: entity.whatsappBusinessAccountId,
    connectionStatus: entity.connectionStatus,
    connectedAt: entity.connectedAt ? entity.connectedAt.toISOString() : null,
    disconnectedAt: entity.disconnectedAt
      ? entity.disconnectedAt.toISOString()
      : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toConversationResponseDto(
  entity: ConversationEntity,
): ConversationResponseDto {
  return {
    id: entity.id,
    customerId: entity.customerId,
    whatsappAccountId: entity.whatsappAccountId,
    status: entity.status,
    assignedUserId: entity.assignedUserId,
    lastMessageAt: entity.lastMessageAt
      ? entity.lastMessageAt.toISOString()
      : null,
    lastInboundMessageAt: entity.lastInboundMessageAt
      ? entity.lastInboundMessageAt.toISOString()
      : null,
    resolvedAt: entity.resolvedAt ? entity.resolvedAt.toISOString() : null,
    closedAt: entity.closedAt ? entity.closedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toMessageResponseDto(
  entity: MessageEntity,
): MessageResponseDto {
  return {
    id: entity.id,
    conversationId: entity.conversationId,
    direction: entity.direction,
    senderType: entity.senderType,
    senderId: entity.senderId,
    messageType: entity.messageType,
    content: entity.content,
    mediaWhatsappId: entity.mediaWhatsappId,
    mediaMimeType: entity.mediaMimeType,
    mediaFilename: entity.mediaFilename,
    mediaSizeBytes: entity.mediaSizeBytes,
    status: entity.status,
    failureReason: entity.failureReason,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
