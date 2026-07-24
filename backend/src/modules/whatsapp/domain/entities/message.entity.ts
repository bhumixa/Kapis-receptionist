import {
  ActorType,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
} from '@prisma/client';

/**
 * A single inbound/outbound WhatsApp message (Milestone 7). `senderType`
 * reuses the platform-wide `ActorType` enum (USER/SYSTEM/CUSTOMER now, AI
 * ready for Milestone 8) rather than a bespoke sender-type enum. Media
 * fields are metadata only (Meta's media id/mime-type/sha256/filename/size
 * as given in the webhook payload) — no binary download/S3 storage this
 * milestone (docs/WHATSAPP_ARCHITECTURE.md).
 */
export interface MessageEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: ActorType;
  senderId: string | null;
  messageType: MessageType;
  content: string | null;
  mediaWhatsappId: string | null;
  mediaMimeType: string | null;
  mediaSha256: string | null;
  mediaFilename: string | null;
  mediaSizeBytes: number | null;
  whatsappMessageId: string | null;
  status: MessageDeliveryStatus;
  failureReason: string | null;
  sourceWebhookEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
