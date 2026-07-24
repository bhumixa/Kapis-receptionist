import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../database/redis.service';

/** A few seconds — just long enough to cover the check-then-create transaction (docs/DATABASE_DESIGN.md Section 10.4). */
const LOCK_TTL_MS = 5000;

/**
 * Lua script so release-by-token is atomic (check-then-delete as a single
 * Redis operation) — without this, a lock that expired and was re-acquired
 * by a different request between our `GET` and `DEL` would be released out
 * from under its new, legitimate holder.
 */
const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface AcquiredLock {
  key: string;
  token: string;
}

/**
 * Thrown when a lock is already held by another in-flight request — the
 * caller (docs/adr/ADR-009-scheduling-engine.md's `AppointmentsService`)
 * catches this and translates it into the domain-facing `409
 * SLOT_NO_LONGER_AVAILABLE` response; this class carries no HTTP concerns of
 * its own, staying reusable by any future booking-adjacent module.
 */
export class BookingLockAcquisitionError extends Error {
  constructor(public readonly employeeId: string) {
    super(`Could not acquire booking lock for employee ${employeeId}.`);
  }
}

/**
 * Redis-backed distributed lock (docs/DATABASE_DESIGN.md Section 10.4,
 * `SET NX PX`) — the first layer of Milestone 6's two-layer booking-conflict
 * prevention (the second is the `btree_gist EXCLUDE` constraint on
 * `appointment_services`, docs/PRISMA_SCHEMA.md Section 14.4). This is a
 * complement to, not a replacement for, that database-level guarantee: the
 * lock avoids wasted work/contention under concurrent load, while the
 * EXCLUDE constraint remains the actual correctness backstop if the lock is
 * ever bypassed or expires mid-transaction.
 *
 * Reuses the existing shared `RedisService` connection (docs/database/
 * redis.service.ts's own stated intent — "distributed locks... share this
 * instance") rather than a second client or a Redlock dependency; a single
 * Redis instance makes the simple `SET NX PX` + token-checked unlock
 * sufficient without multi-node lock-quorum machinery.
 */
@Injectable()
export class BookingLockService {
  private readonly logger = new Logger(BookingLockService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Acquires one lock per distinct `employeeId` involved in a booking
   * (Milestone 6 supports per-service employee assignment, so a single
   * multi-service appointment may need several employees' locks at once).
   * Keys are sorted before acquisition so two concurrent requests involving
   * an overlapping set of employees always attempt to acquire in the same
   * global order, preventing a lock-ordering deadlock.
   *
   * All-or-nothing: if any key is already held, every lock acquired so far
   * in this call is released before throwing.
   */
  async acquire(
    tenantId: string,
    employeeIds: string[],
  ): Promise<AcquiredLock[]> {
    const uniqueSortedIds = Array.from(new Set(employeeIds)).sort();
    const acquired: AcquiredLock[] = [];

    try {
      for (const employeeId of uniqueSortedIds) {
        const key = `lock:availability:${tenantId}:${employeeId}`;
        const token = randomUUID();
        const result = await this.redis.set(
          key,
          token,
          'PX',
          LOCK_TTL_MS,
          'NX',
        );
        if (result !== 'OK') {
          throw new BookingLockAcquisitionError(employeeId);
        }
        acquired.push({ key, token });
      }
      return acquired;
    } catch (error) {
      await this.release(acquired);
      throw error;
    }
  }

  async release(locks: AcquiredLock[]): Promise<void> {
    for (const lock of locks) {
      try {
        await this.redis.eval(UNLOCK_SCRIPT, 1, lock.key, lock.token);
      } catch (error) {
        // Never let a release failure surface to the caller — the lock's
        // short TTL is the backstop if this genuinely fails to clean up.
        this.logger.warn(
          `Failed to release booking lock ${lock.key}: ${(error as Error).message}`,
        );
      }
    }
  }
}
