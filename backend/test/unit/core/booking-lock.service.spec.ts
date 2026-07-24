import {
  BookingLockAcquisitionError,
  BookingLockService,
} from '../../../src/core/locking/booking-lock.service';
import { RedisService } from '../../../src/database/redis.service';

describe('BookingLockService', () => {
  let redis: jest.Mocked<Pick<RedisService, 'set' | 'eval'>>;
  let service: BookingLockService;

  beforeEach(() => {
    redis = {
      set: jest.fn(),
      eval: jest.fn(),
    };
    service = new BookingLockService(redis as unknown as RedisService);
  });

  it('acquires one lock per distinct employeeId, sorted for a stable global order', async () => {
    redis.set.mockResolvedValue('OK');

    const locks = await service.acquire('tenant-1', [
      'employee-b',
      'employee-a',
      'employee-a',
    ]);

    expect(locks).toHaveLength(2);
    expect(locks.map((l) => l.key)).toEqual([
      'lock:availability:tenant-1:employee-a',
      'lock:availability:tenant-1:employee-b',
    ]);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('throws BookingLockAcquisitionError and releases already-acquired locks when a key is already held', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    redis.eval.mockResolvedValue(1);

    await expect(
      service.acquire('tenant-1', ['employee-a', 'employee-b']),
    ).rejects.toBeInstanceOf(BookingLockAcquisitionError);

    // The first lock (employee-a) was acquired then must be released on failure.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('release() never throws even if the underlying Redis call fails', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));

    await expect(
      service.release([
        { key: 'lock:availability:tenant-1:employee-a', token: 'abc' },
      ]),
    ).resolves.toBeUndefined();
  });
});
