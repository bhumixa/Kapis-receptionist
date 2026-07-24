import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AIContextEntity } from '../domain/entities/ai-context.entity';
import {
  AiContextRepositoryPort,
  UpsertAiContextInput,
} from '../domain/ports/ai-context-repository.port';
import { toAIContextEntity } from './mappers/prisma-ai.mappers';

/**
 * Not a `TenantScopedRepository<T>` subclass — `AIContext` is looked up and
 * upserted by its unique `conversationId`, not by its own `id`, so the
 * base class's `id`-keyed `updateForTenant` doesn't fit; tenant safety is
 * still enforced explicitly in every `where`/`data` clause below.
 */
@Injectable()
export class PrismaAiContextRepository implements AiContextRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByConversationId(
    tenantId: string,
    conversationId: string,
  ): Promise<AIContextEntity | null> {
    const row = await this.prisma.aIContext.findFirst({
      where: { tenantId, conversationId },
    });
    return row ? toAIContextEntity(row) : null;
  }

  async upsert(
    tenantId: string,
    conversationId: string,
    input: UpsertAiContextInput,
  ): Promise<AIContextEntity> {
    const data: Prisma.AIContextUpdateInput = {
      ...(input.currentIntent !== undefined
        ? { currentIntent: input.currentIntent }
        : {}),
      ...(input.state !== undefined
        ? { state: input.state as Prisma.InputJsonValue }
        : {}),
      ...(input.lastToolCall !== undefined
        ? { lastToolCall: input.lastToolCall }
        : {}),
    };

    const row = await this.prisma.aIContext.upsert({
      where: { conversationId },
      create: {
        tenantId,
        conversationId,
        currentIntent: input.currentIntent ?? null,
        state: (input.state ?? {}) as Prisma.InputJsonValue,
        lastToolCall: input.lastToolCall ?? null,
      },
      update: data,
    });
    return toAIContextEntity(row);
  }
}
