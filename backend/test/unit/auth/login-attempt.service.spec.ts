import { LoginAttemptService } from '../../../src/modules/auth/application/login-attempt.service';
import { RedisService } from '../../../src/database/redis.service';

const CONFIG: Record<string, number> = {
  'loginSecurity.maxAttempts': 5,
  'loginSecurity.attemptWindowSeconds': 900,
  'loginSecurity.lockoutSeconds': 900,
};

function buildService(redisOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const redis = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-2), // -2 = key doesn't exist (ioredis convention)
    ...redisOverrides,
  };
  const configService = {
    getOrThrow: (key: string) => CONFIG[key],
  };
  const service = new LoginAttemptService(
    redis as unknown as RedisService,
    configService as unknown as ConstructorParameters<
      typeof LoginAttemptService
    >[1],
  );
  return { service, redis };
}

describe('LoginAttemptService', () => {
  describe('getLockoutStatus', () => {
    it('reports not locked when the lockout key has no TTL', async () => {
      const { service } = buildService({
        ttl: jest.fn().mockResolvedValue(-2),
      });
      const status = await service.getLockoutStatus('owner@salon.com');
      expect(status).toEqual({ locked: false, retryAfterSeconds: 0 });
    });

    it('reports locked with the remaining TTL when the lockout key exists', async () => {
      const { service } = buildService({
        ttl: jest.fn().mockResolvedValue(300),
      });
      const status = await service.getLockoutStatus('owner@salon.com');
      expect(status).toEqual({ locked: true, retryAfterSeconds: 300 });
    });
  });

  describe('recordFailure', () => {
    it('increments the attempts counter and sets its expiry on the first failure', async () => {
      const { service, redis } = buildService({
        incr: jest.fn().mockResolvedValue(1),
      });

      const status = await service.recordFailure('owner@salon.com');

      expect(redis.incr).toHaveBeenCalledWith(
        'auth:login-attempts:owner@salon.com',
      );
      expect(redis.expire).toHaveBeenCalledWith(
        'auth:login-attempts:owner@salon.com',
        900,
      );
      expect(status).toEqual({ locked: false, retryAfterSeconds: 0 });
    });

    it('does not reset the counter expiry on subsequent failures within the window', async () => {
      const { service, redis } = buildService({
        incr: jest.fn().mockResolvedValue(3),
      });

      await service.recordFailure('owner@salon.com');

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('locks the account once the attempt count reaches the configured maximum', async () => {
      const { service, redis } = buildService({
        incr: jest.fn().mockResolvedValue(5),
      });

      const status = await service.recordFailure('owner@salon.com');

      expect(redis.set).toHaveBeenCalledWith(
        'auth:login-lockout:owner@salon.com',
        '1',
        'EX',
        900,
      );
      expect(redis.del).toHaveBeenCalledWith(
        'auth:login-attempts:owner@salon.com',
      );
      expect(status).toEqual({ locked: true, retryAfterSeconds: 900 });
    });
  });

  describe('recordSuccess', () => {
    it('clears both the attempts counter and any lockout key', async () => {
      const { service, redis } = buildService();

      await service.recordSuccess('owner@salon.com');

      expect(redis.del).toHaveBeenCalledWith(
        'auth:login-attempts:owner@salon.com',
        'auth:login-lockout:owner@salon.com',
      );
    });
  });
});
