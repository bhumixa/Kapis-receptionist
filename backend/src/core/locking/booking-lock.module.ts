import { Module } from '@nestjs/common';
import { BookingLockService } from './booking-lock.service';

/**
 * Small, dedicated module (same shape as `AuditLogModule`) — `RedisService`
 * needs no explicit import here since `DatabaseModule` is `@Global()`.
 */
@Module({
  providers: [BookingLockService],
  exports: [BookingLockService],
})
export class BookingLockModule {}
