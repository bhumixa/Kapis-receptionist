import type {
  AIContext as PrismaAIContext,
  ConversationSummary as PrismaConversationSummary,
  PromptVersion as PrismaPromptVersion,
} from '@prisma/client';
import { AIContextEntity } from '../../domain/entities/ai-context.entity';
import { ConversationSummaryEntity } from '../../domain/entities/conversation-summary.entity';
import { PromptVersionEntity } from '../../domain/entities/prompt-version.entity';

export function toAIContextEntity(row: PrismaAIContext): AIContextEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    currentIntent: row.currentIntent,
    state: row.state as Record<string, unknown>,
    lastToolCall: row.lastToolCall,
    updatedAt: row.updatedAt,
  };
}

export function toConversationSummaryEntity(
  row: PrismaConversationSummary,
): ConversationSummaryEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    summaryText: row.summaryText,
    messageCount: row.messageCount,
    lastCustomerIntent: row.lastCustomerIntent,
    generatedAt: row.generatedAt,
    aiPromptVersion: row.aiPromptVersion,
  };
}

export function toPromptVersionEntity(
  row: PrismaPromptVersion,
): PromptVersionEntity {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    description: row.description,
    isActive: row.isActive,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
  };
}
