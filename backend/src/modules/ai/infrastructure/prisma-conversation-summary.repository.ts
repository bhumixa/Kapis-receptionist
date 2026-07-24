import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ConversationSummaryEntity } from '../domain/entities/conversation-summary.entity';
import {
  ConversationSummaryRepositoryPort,
  UpsertConversationSummaryInput,
} from '../domain/ports/conversation-summary-repository.port';
import { toConversationSummaryEntity } from './mappers/prisma-ai.mappers';

/** Same "looked up by `conversationId`, not `id`" shape as `PrismaAiContextRepository` — see that class's doc comment. */
@Injectable()
export class PrismaConversationSummaryRepository implements ConversationSummaryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByConversationId(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationSummaryEntity | null> {
    const row = await this.prisma.conversationSummary.findFirst({
      where: { tenantId, conversationId },
    });
    return row ? toConversationSummaryEntity(row) : null;
  }

  async upsert(
    tenantId: string,
    conversationId: string,
    input: UpsertConversationSummaryInput,
  ): Promise<ConversationSummaryEntity> {
    const row = await this.prisma.conversationSummary.upsert({
      where: { conversationId },
      create: {
        tenantId,
        conversationId,
        summaryText: input.summaryText,
        messageCount: input.messageCount,
        lastCustomerIntent: input.lastCustomerIntent,
        aiPromptVersion: input.aiPromptVersion,
      },
      update: {
        summaryText: input.summaryText,
        messageCount: input.messageCount,
        lastCustomerIntent: input.lastCustomerIntent,
        aiPromptVersion: input.aiPromptVersion,
        generatedAt: new Date(),
      },
    });
    return toConversationSummaryEntity(row);
  }
}
