import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** `TenantContextService` comes from `CoreModule`; `RedisService` needs no explicit import since `DatabaseModule` is `@Global()`. */
@Module({
  imports: [CoreModule],
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
