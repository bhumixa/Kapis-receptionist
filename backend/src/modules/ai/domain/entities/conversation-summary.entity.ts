/**
 * Denormalized rollup of a conversation (SYSTEM_ARCHITECTURE.md 5.7) —
 * avoids re-reading/re-summarizing the full `Message` history on every
 * reference. Explicitly a derived/cache record: regeneratable from
 * `Message` history at any time, never authoritative source data.
 */
export interface ConversationSummaryEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  summaryText: string;
  messageCount: number;
  lastCustomerIntent: string | null;
  generatedAt: Date;
  aiPromptVersion: string | null;
}
