/** Mirrors `backend/src/modules/whatsapp/interface/dto/*.dto.ts`. */

export type ConversationStatus = 'OPEN' | 'RESOLVED' | 'CLOSED';

export interface Conversation {
  id: string;
  customerId: string;
  whatsappAccountId: string;
  status: ConversationStatus;
  assignedUserId: string | null;
  lastMessageAt: string | null;
  lastInboundMessageAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSenderType = 'USER' | 'AI' | 'SYSTEM' | 'CUSTOMER';
export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'INTERACTIVE'
  | 'UNSUPPORTED';
export type MessageDeliveryStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderId: string | null;
  messageType: MessageType;
  content: string | null;
  mediaWhatsappId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaSizeBytes: number | null;
  status: MessageDeliveryStatus;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MESSAGE_STATUS_LABELS: Record<MessageDeliveryStatus, string> = {
  QUEUED: 'Sending…',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
};

export type WhatsAppConnectionStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface WhatsAppAccount {
  id: string;
  phoneNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  connectionStatus: WhatsAppConnectionStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
