import { RedisService } from '../../../src/database/redis.service';
import { AiContextService } from '../../../src/modules/ai/application/ai-context.service';
import type { AiContextRepositoryPort } from '../../../src/modules/ai/domain/ports/ai-context-repository.port';
import type { AIContextEntity } from '../../../src/modules/ai/domain/entities/ai-context.entity';

function makeContext(
  overrides: Partial<AIContextEntity> = {},
): AIContextEntity {
  return {
    id: 'ctx-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    currentIntent: null,
    state: {},
    lastToolCall: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AiContextService', () => {
  let repository: jest.Mocked<AiContextRepositoryPort>;
  let redis: jest.Mocked<Pick<RedisService, 'get' | 'set'>>;
  let service: AiContextService;

  beforeEach(() => {
    repository = { findByConversationId: jest.fn(), upsert: jest.fn() };
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    service = new AiContextService(
      repository,
      redis as unknown as RedisService,
    );
  });

  describe('getContext', () => {
    it('returns the cached value without touching the repository on a cache hit', async () => {
      const cached = makeContext({ currentIntent: 'BOOKING' });
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getContext('tenant-1', 'conversation-1');

      expect(result.currentIntent).toBe('BOOKING');
      expect(repository.findByConversationId).not.toHaveBeenCalled();
    });

    it('falls back to the repository and repopulates the cache on a miss', async () => {
      redis.get.mockResolvedValue(null);
      const stored = makeContext({ currentIntent: 'FAQ' });
      repository.findByConversationId.mockResolvedValue(stored);

      const result = await service.getContext('tenant-1', 'conversation-1');

      expect(result.currentIntent).toBe('FAQ');
      expect(redis.set).toHaveBeenCalledWith(
        'ai:context:conversation-1',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('returns an empty, unpersisted default when no context exists anywhere', async () => {
      redis.get.mockResolvedValue(null);
      repository.findByConversationId.mockResolvedValue(null);

      const result = await service.getContext('tenant-1', 'conversation-1');

      expect(result.currentIntent).toBeNull();
      expect(result.state).toEqual({});
    });
  });

  describe('updateContext', () => {
    it('shallow-merges new state into the existing state rather than replacing it', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify(
          makeContext({ state: { selectedServiceId: 'service-1' } }),
        ),
      );
      repository.upsert.mockImplementation((tenantId, conversationId, input) =>
        Promise.resolve(
          makeContext({ state: input.state as Record<string, unknown> }),
        ),
      );

      const result = await service.updateContext('tenant-1', 'conversation-1', {
        state: { selectedTime: '2026-08-03T14:00:00Z' },
      });

      expect(result.state).toEqual({
        selectedServiceId: 'service-1',
        selectedTime: '2026-08-03T14:00:00Z',
      });
    });

    it('updates the Redis cache after a successful upsert', async () => {
      redis.get.mockResolvedValue(null);
      repository.findByConversationId.mockResolvedValue(null);
      repository.upsert.mockResolvedValue(
        makeContext({ currentIntent: 'BOOKING' }),
      );

      await service.updateContext('tenant-1', 'conversation-1', {
        currentIntent: 'BOOKING',
      });

      expect(redis.set).toHaveBeenCalledWith(
        'ai:context:conversation-1',
        expect.stringContaining('BOOKING'),
        'EX',
        expect.any(Number),
      );
    });
  });
});
