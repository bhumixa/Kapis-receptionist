import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service';
import { AIContextEntity } from '../domain/entities/ai-context.entity';
import {
  AI_CONTEXT_REPOSITORY,
  type AiContextRepositoryPort,
  type UpsertAiContextInput,
} from '../domain/ports/ai-context-repository.port';

const CACHE_TTL_SECONDS = 6 * 60 * 60; // A few hours of inactivity (DATABASE_DESIGN.md 10.2) — refreshed on every turn.

function cacheKey(conversationId: string): string {
  return `ai:context:${conversationId}`;
}

/**
 * Per-conversation working memory (SYSTEM_ARCHITECTURE.md 5.2/5.5,
 * DATABASE_DESIGN.md 10.2) — a Redis cache in front of the durable
 * `AIContext` row, purely a latency optimization: a cache miss/eviction
 * always falls back to (and repopulates from) Postgres, never a
 * correctness concern.
 */
@Injectable()
export class AiContextService {
  constructor(
    @Inject(AI_CONTEXT_REPOSITORY)
    private readonly repository: AiContextRepositoryPort,
    private readonly redis: RedisService,
  ) {}

  /** Never returns `null` — an untouched conversation gets an empty, unpersisted default state. */
  async getContext(
    tenantId: string,
    conversationId: string,
  ): Promise<AIContextEntity> {
    const cached = await this.redis.get(cacheKey(conversationId));
    if (cached) {
      return JSON.parse(cached) as AIContextEntity;
    }

    const existing = await this.repository.findByConversationId(
      tenantId,
      conversationId,
    );
    const context: AIContextEntity = existing ?? {
      id: '',
      tenantId,
      conversationId,
      currentIntent: null,
      state: {},
      lastToolCall: null,
      updatedAt: new Date(),
    };
    await this.cache(context);
    return context;
  }

  /** Shallow-merges `input.state` into the existing state — callers pass only the slots they're changing, never the whole object. */
  async updateContext(
    tenantId: string,
    conversationId: string,
    input: UpsertAiContextInput,
  ): Promise<AIContextEntity> {
    const current = await this.getContext(tenantId, conversationId);
    const merged: UpsertAiContextInput = {
      currentIntent: input.currentIntent ?? current.currentIntent,
      lastToolCall: input.lastToolCall ?? current.lastToolCall,
      state:
        input.state !== undefined
          ? { ...current.state, ...input.state }
          : current.state,
    };

    const updated = await this.repository.upsert(
      tenantId,
      conversationId,
      merged,
    );
    await this.cache(updated);
    return updated;
  }

  private async cache(context: AIContextEntity): Promise<void> {
    await this.redis.set(
      cacheKey(context.conversationId),
      JSON.stringify(context),
      'EX',
      CACHE_TTL_SECONDS,
    );
  }
}
