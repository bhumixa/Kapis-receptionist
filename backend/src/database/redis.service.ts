import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Single shared Redis connection (SYSTEM_ARCHITECTURE.md Section 11.3 —
 * cache, queue broker, distributed locks, and idempotency keys all share
 * this instance at this stage; split into dedicated connections only if a
 * future concern's throughput demands it, per the same "don't build for
 * hypothetical scale yet" principle applied elsewhere in this codebase).
 */
@Injectable()
export class RedisService
  extends Redis
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    super(configService.getOrThrow<string>('redis.url'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.logger.log('Redis connection established');
  }

  onModuleDestroy(): void {
    this.disconnect();
    this.logger.log('Redis connection closed');
  }
}
