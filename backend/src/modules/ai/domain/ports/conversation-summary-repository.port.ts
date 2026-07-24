import { ConversationSummaryEntity } from '../entities/conversation-summary.entity';

export const CONVERSATION_SUMMARY_REPOSITORY = Symbol(
  'CONVERSATION_SUMMARY_REPOSITORY',
);

export interface UpsertConversationSummaryInput {
  summaryText: string;
  messageCount: number;
  lastCustomerIntent: string | null;
  aiPromptVersion: string | null;
}

export interface ConversationSummaryRepositoryPort {
  findByConversationId(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationSummaryEntity | null>;
  upsert(
    tenantId: string,
    conversationId: string,
    input: UpsertConversationSummaryInput,
  ): Promise<ConversationSummaryEntity>;
}
