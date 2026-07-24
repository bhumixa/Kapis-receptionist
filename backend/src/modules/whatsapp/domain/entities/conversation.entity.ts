import { ConversationStatus } from '@prisma/client';

/**
 * A WhatsApp conversation thread between one customer and one tenant
 * (Milestone 7). No `ESCALATED`/`HUMAN_HANDLING` status — meaningless
 * without an AI auto-responder to escalate from (Milestone 8 extends
 * `ConversationStatus`). `lastInboundMessageAt` drives the 24-hour
 * customer-service-messaging-window check; `lastMessageAt` (any direction)
 * drives inbox sort order.
 */
export interface ConversationEntity {
  id: string;
  tenantId: string;
  customerId: string;
  whatsappAccountId: string;
  status: ConversationStatus;
  assignedUserId: string | null;
  lastMessageAt: Date | null;
  lastInboundMessageAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
