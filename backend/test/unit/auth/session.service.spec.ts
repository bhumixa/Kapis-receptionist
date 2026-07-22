import { JwtService } from '@nestjs/jwt';
import {
  CreateRefreshTokenInput,
  RefreshTokenRepositoryPort,
} from '../../../src/modules/auth/domain/ports/refresh-token-repository.port';
import { RefreshTokenRecord } from '../../../src/modules/auth/domain/entities/refresh-token-record.entity';
import {
  InvalidRefreshTokenException,
  RefreshTokenReuseDetectedException,
} from '../../../src/modules/auth/application/exceptions/auth.exceptions';
import { SecurityEventService } from '../../../src/modules/auth/application/security-event.service';
import { SessionService } from '../../../src/modules/auth/application/session.service';
import { TokenService } from '../../../src/modules/auth/application/token.service';

/** In-memory fake standing in for the Prisma-backed repository — exercises real SessionService sequencing logic. */
class FakeRefreshTokenRepository implements RefreshTokenRepositoryPort {
  private rows = new Map<string, RefreshTokenRecord>();
  private nextId = 1;

  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: `token-${this.nextId++}`,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: new Date(),
    };
    this.rows.set(record.id, record);
    return Promise.resolve(record);
  }

  findByHash(hash: string): Promise<RefreshTokenRecord | null> {
    for (const row of this.rows.values()) {
      if (row.refreshTokenHash === hash) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  revoke(id: string, replacedBySessionId?: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.revokedAt = new Date();
      row.replacedBySessionId = replacedBySessionId ?? null;
    }
    return Promise.resolve();
  }

  revokeAllActiveForUser(userId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.userId === userId && !row.revokedAt) {
        row.revokedAt = new Date();
        count++;
      }
    }
    return Promise.resolve(count);
  }
}

function buildTokenService(): TokenService {
  const values: Record<string, string | number> = {
    'jwt.accessSecret': 'unit-test-access-secret-unit-test-access-secret',
    'jwt.accessExpiresInSeconds': 900,
    'jwt.refreshPepper': 'unit-test-refresh-pepper-unit-test-refresh-pepper',
    'jwt.refreshExpiresInSeconds': 2_592_000,
  };
  const configService = {
    getOrThrow: (key: string) => values[key],
  };
  return new TokenService(
    new JwtService(),
    configService as unknown as ConstructorParameters<typeof TokenService>[1],
  );
}

describe('SessionService', () => {
  let repo: FakeRefreshTokenRepository;
  let securityEvents: jest.Mocked<Pick<SecurityEventService, 'record'>>;
  let service: SessionService;
  const meta = { userAgent: 'jest', ipAddress: '127.0.0.1' };

  beforeEach(() => {
    repo = new FakeRefreshTokenRepository();
    securityEvents = { record: jest.fn() };
    service = new SessionService(
      repo,
      buildTokenService(),
      securityEvents as unknown as SecurityEventService,
    );
  });

  it('issues a session with a raw token that hashes to what was persisted', async () => {
    const issued = await service.issueSession('user-1', meta);
    const stored = await repo.findByHash(
      // reach into the same TokenService the SessionService uses via a fresh instance with identical config
      buildTokenService().hashRefreshToken(issued.rawRefreshToken),
    );
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe('user-1');
  });

  it('rotate(): happy path revokes the old token and links it forward to the new one', async () => {
    const issued = await service.issueSession('user-1', meta);
    const rotated = await service.rotate(issued.rawRefreshToken, meta);

    expect(rotated.userId).toBe('user-1');
    expect(rotated.rawRefreshToken).not.toEqual(issued.rawRefreshToken);

    const oldHash = buildTokenService().hashRefreshToken(
      issued.rawRefreshToken,
    );
    const oldRow = await repo.findByHash(oldHash);
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(oldRow?.replacedBySessionId).toBe(rotated.id);
  });

  it('rotate(): reuse of an already-rotated token revokes every active session and throws', async () => {
    const issued = await service.issueSession('user-1', meta);
    await service.rotate(issued.rawRefreshToken, meta); // first, legitimate rotation
    const other = await service.issueSession('user-1', meta); // a second, unrelated active session

    await expect(
      service.rotate(issued.rawRefreshToken, meta), // replay of the stale, rotated-away token
    ).rejects.toBeInstanceOf(RefreshTokenReuseDetectedException);

    expect(securityEvents.record).toHaveBeenCalledWith(
      'REFRESH_TOKEN_REUSE_DETECTED',
      expect.objectContaining({ userId: 'user-1' }),
    );
    const otherRow = await repo.findByHash(
      buildTokenService().hashRefreshToken(other.rawRefreshToken),
    );
    expect(otherRow?.revokedAt).not.toBeNull(); // collateral revocation is intended here
  });

  it('rotate(): a token revoked by plain logout is rejected as merely invalid, not reuse', async () => {
    const issued = await service.issueSession('user-1', meta);
    const other = await service.issueSession('user-1', meta);
    await service.revoke(issued.rawRefreshToken); // logout, not rotation — no replacedBySessionId

    await expect(
      service.rotate(issued.rawRefreshToken, meta),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);

    expect(securityEvents.record).not.toHaveBeenCalledWith(
      'REFRESH_TOKEN_REUSE_DETECTED',
      expect.anything(),
    );
    const otherRow = await repo.findByHash(
      buildTokenService().hashRefreshToken(other.rawRefreshToken),
    );
    expect(otherRow?.revokedAt).toBeNull(); // the other active session must be untouched
  });

  it('rotate(): an expired token is rejected as invalid', async () => {
    const issued = await service.issueSession('user-1', meta);
    const hash = buildTokenService().hashRefreshToken(issued.rawRefreshToken);
    const row = await repo.findByHash(hash);
    row!.expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.rotate(issued.rawRefreshToken, meta),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
  });

  it('rotate(): an unknown token is rejected as invalid', async () => {
    await expect(
      service.rotate('this-token-was-never-issued', meta),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
  });

  it('revoke(): is a safe no-op for an unknown token', async () => {
    await expect(service.revoke('unknown')).resolves.toBeUndefined();
  });

  it("revokeAllForUser(): revokes only that user's active sessions", async () => {
    await service.issueSession('user-1', meta);
    await service.issueSession('user-1', meta);
    await service.issueSession('user-2', meta);

    const count = await service.revokeAllForUser('user-1');
    expect(count).toBe(2);
  });
});
