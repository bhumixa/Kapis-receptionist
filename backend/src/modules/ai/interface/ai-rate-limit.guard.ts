import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { RedisService } from '../../../database/redis.service';
import { TenantContextService } from '../../../core/context/tenant-context.service';

const WINDOW_SECONDS = 60;

/**
 * Per-tenant `POST /ai/chat` rate limit — the "AI-Conversational" tier
 * API_SPECIFICATION.md's rate-limit table already documents (30 req/min
 * per tenant) and DATABASE_DESIGN.md Section 10.3 already specifies the
 * Redis key pattern for (`ratelimit:tenant-messages:{tenantId}:
 * {periodBucket}`, adapted here to `ratelimit:ai:*`). A fixed-window
 * counter — simple `INCR`+`EXPIRE`, not the generic per-IP `@nestjs/
 * throttler` tiers used elsewhere in this codebase (`auth.module.ts`),
 * since this needs to key by *tenant*, not caller IP: many staff/customers
 * across many IPs all count against one tenant's shared budget.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(): Promise<boolean> {
    const tenantId = await this.tenantContext.requireTenantId();
    const limit = this.configService.getOrThrow<number>(
      'ai.rateLimitPerMinute',
    );
    const periodBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `ratelimit:ai:${tenantId}:${periodBucket}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS + 10);
    }

    if (count > limit) {
      throw new ThrottlerException();
    }
    return true;
  }
}
