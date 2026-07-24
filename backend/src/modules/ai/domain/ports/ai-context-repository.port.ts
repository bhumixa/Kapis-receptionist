import { AIContextEntity } from '../entities/ai-context.entity';

export const AI_CONTEXT_REPOSITORY = Symbol('AI_CONTEXT_REPOSITORY');

export interface UpsertAiContextInput {
  currentIntent?: string | null;
  state?: Record<string, unknown>;
  lastToolCall?: string | null;
}

export interface AiContextRepositoryPort {
  findByConversationId(
    tenantId: string,
    conversationId: string,
  ): Promise<AIContextEntity | null>;
  /** Creates the row on first use, otherwise merges into the existing one — `AIContext` is always 1:1 with `Conversation`. */
  upsert(
    tenantId: string,
    conversationId: string,
    input: UpsertAiContextInput,
  ): Promise<AIContextEntity>;
}
