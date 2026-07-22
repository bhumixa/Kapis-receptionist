import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../database/redis.service';

const ATTEMPTS_KEY_PREFIX = 'auth:login-attempts:';
const LOCKOUT_KEY_PREFIX = 'auth:login-lockout:';

export interface LockoutStatus {
  locked: boolean;
  /** Seconds remaining until the lockout clears; 0 when not locked. */
  retryAfterSeconds: number;
}

/**
 * Redis-backed login-attempt tracking and temporary account lockout
 * (docs/AUTHENTICATION.md — Sprint 2.3 Account Security). Deliberately
 * **not** a new Postgres table: this state is ephemeral by nature
 * (DATABASE_DESIGN.md Section 1.6) and Redis is already the platform's
 * designated home for rate-limiting/counter state
 * (SYSTEM_ARCHITECTURE.md Section 11.3/1.3).
 *
 * Keyed by normalized email, not user ID — deliberately, so lockout
 * behavior itself never reveals whether an account exists for a given
 * email (the same enumeration-resistance principle `AuthService.login`
 * already applies to its `INVALID_CREDENTIALS` response).
 */
@Injectable()
export class LoginAttemptService {
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async getLockoutStatus(email: string): Promise<LockoutStatus> {
    const ttl = await this.redis.ttl(this.lockoutKey(email));
    return ttl > 0
      ? { locked: true, retryAfterSeconds: ttl }
      : { locked: false, retryAfterSeconds: 0 };
  }

  /** Records a failed attempt; locks the account out once the threshold is reached. Returns the resulting lockout status. */
  async recordFailure(email: string): Promise<LockoutStatus> {
    const attemptsKey = this.attemptsKey(email);
    const count = await this.redis.incr(attemptsKey);
    if (count === 1) {
      await this.redis.expire(
        attemptsKey,
        this.configService.getOrThrow<number>(
          'loginSecurity.attemptWindowSeconds',
        ),
      );
    }

    const maxAttempts = this.configService.getOrThrow<number>(
      'loginSecurity.maxAttempts',
    );
    if (count < maxAttempts) {
      return { locked: false, retryAfterSeconds: 0 };
    }

    const lockoutSeconds = this.configService.getOrThrow<number>(
      'loginSecurity.lockoutSeconds',
    );
    await this.redis.set(this.lockoutKey(email), '1', 'EX', lockoutSeconds);
    await this.redis.del(attemptsKey);
    return { locked: true, retryAfterSeconds: lockoutSeconds };
  }

  /** Clears tracking state on a successful login. */
  async recordSuccess(email: string): Promise<void> {
    await this.redis.del(this.attemptsKey(email), this.lockoutKey(email));
  }

  private attemptsKey(email: string): string {
    return `${ATTEMPTS_KEY_PREFIX}${email}`;
  }

  private lockoutKey(email: string): string {
    return `${LOCKOUT_KEY_PREFIX}${email}`;
  }
}
