import { ConversationStatus } from '@prisma/client';

/**
 * A WhatsApp conversation thread between one customer and one tenant
 * (Milestone 7). `lastInboundMessageAt` drives the 24-hour
 * customer-service-messaging-window check; `lastMessageAt` (any direction)
 * drives inbox sort order. `ESCALATED` (Milestone 8, docs/adr/
 * ADR-011-ai-receptionist.md) is the one AI hand-off state added — no
 * separate `HUMAN_HANDLING`; `assignedUserId` distinguishes
 * queued-unclaimed from claimed-by-staff within it.
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
  escalatedAt: Date | null;
  escalationReason: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
