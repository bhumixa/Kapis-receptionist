import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Root BullMQ connection (Milestone 7 — the first job-queue consumer this
 * codebase has ever had; `src/queues/` existed only as a reserved,
 * `.gitkeep`-only placeholder before now).
 *
 * A dedicated `ioredis` connection, not the shared `RedisService` instance
 * (`database/redis.service.ts`) used for caching/locks/idempotency —
 * BullMQ requires `maxRetriesPerRequest: null` on any connection it drives
 * (its own blocking-command retry semantics conflict with a finite
 * `maxRetriesPerRequest`), which would be wrong for `RedisService`'s other,
 * latency-sensitive callers (locks, idempotency checks).
 *
 * Feature modules register their own named queues via
 * `BullModule.registerQueue({ name: '...' })` against this shared root
 * connection — they don't need to (and shouldn't) call `forRootAsync` again.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('redis.url'),
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class BullmqRootModule {}
