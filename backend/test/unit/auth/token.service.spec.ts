import { JwtService } from '@nestjs/jwt';
import { RoleName } from '@prisma/client';
import { TokenService } from '../../../src/modules/auth/application/token.service';

const CONFIG: Record<string, string | number> = {
  'jwt.accessSecret': 'unit-test-access-secret-unit-test-access-secret',
  'jwt.accessExpiresInSeconds': 900,
  'jwt.refreshPepper': 'unit-test-refresh-pepper-unit-test-refresh-pepper',
  'jwt.refreshExpiresInSeconds': 2_592_000,
};

function buildTokenService(overrides: Partial<typeof CONFIG> = {}) {
  const values = { ...CONFIG, ...overrides };
  const configService = {
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new Error(`missing config: ${key}`);
      }
      return values[key];
    },
  };
  return new TokenService(
    new JwtService(),
    configService as unknown as ConstructorParameters<typeof TokenService>[1],
  );
}

describe('TokenService', () => {
  const payload = {
    sub: 'user-1',
    email: 'owner@salon.com',
    tenantId: 'tenant-1',
    roles: [RoleName.OWNER],
  };

  it('signs an access token that verifies back to the same claims', () => {
    const service = buildTokenService();
    const { accessToken, expiresIn } = service.signAccessToken(payload);

    expect(expiresIn).toBe(900);
    const decoded = service.verifyAccessToken(accessToken);
    expect(decoded).toMatchObject(payload);
  });

  it('rejects a token signed with a different access secret', () => {
    const signer = buildTokenService({
      'jwt.accessSecret': 'secret-A-secret-A-secret-A-secret-A',
    });
    const verifier = buildTokenService({
      'jwt.accessSecret': 'secret-B-secret-B-secret-B-secret-B',
    });
    const { accessToken } = signer.signAccessToken(payload);

    expect(() => verifier.verifyAccessToken(accessToken)).toThrow();
  });

  it('generates high-entropy, unique opaque refresh tokens', () => {
    const service = buildTokenService();
    const a = service.generateOpaqueRefreshToken();
    const b = service.generateOpaqueRefreshToken();

    expect(a).not.toEqual(b);
    // 64 random bytes, base64url-encoded, has no padding/`=` characters.
    expect(a.length).toBeGreaterThanOrEqual(80);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes a refresh token deterministically for the same pepper', () => {
    const service = buildTokenService();
    const raw = service.generateOpaqueRefreshToken();

    expect(service.hashRefreshToken(raw)).toEqual(
      service.hashRefreshToken(raw),
    );
  });

  it('produces a different hash for the same raw token under a different pepper', () => {
    const raw = 'a-fixed-raw-token-value-for-this-test';
    const serviceA = buildTokenService({
      'jwt.refreshPepper': 'pepper-A-pepper-A-pepper-A-pepper-A',
    });
    const serviceB = buildTokenService({
      'jwt.refreshPepper': 'pepper-B-pepper-B-pepper-B-pepper-B',
    });

    expect(serviceA.hashRefreshToken(raw)).not.toEqual(
      serviceB.hashRefreshToken(raw),
    );
  });

  it('never leaks the raw token into its own hash (not a simple pass-through)', () => {
    const service = buildTokenService();
    const raw = 'a-fixed-raw-token-value-for-this-test';
    expect(service.hashRefreshToken(raw)).not.toContain(raw);
  });

  describe('generic opaque token (email verification / password reset)', () => {
    it('generates high-entropy, unique tokens', () => {
      const service = buildTokenService();
      const a = service.generateOpaqueToken();
      const b = service.generateOpaqueToken();

      expect(a).not.toEqual(b);
      // 32 random bytes, base64url-encoded.
      expect(a.length).toBeGreaterThanOrEqual(40);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('hashes deterministically, with no pepper/secret dependency', () => {
      const service = buildTokenService();
      const raw = service.generateOpaqueToken();

      expect(service.hashOpaqueToken(raw)).toEqual(
        service.hashOpaqueToken(raw),
      );
    });

    it('produces the same hash regardless of the configured refresh pepper (deliberately unpeppered, unlike the refresh token)', () => {
      const raw = 'a-fixed-raw-token-value-for-this-test';
      const serviceA = buildTokenService({
        'jwt.refreshPepper': 'pepper-A-pepper-A-pepper-A-pepper-A',
      });
      const serviceB = buildTokenService({
        'jwt.refreshPepper': 'pepper-B-pepper-B-pepper-B-pepper-B',
      });

      expect(serviceA.hashOpaqueToken(raw)).toEqual(
        serviceB.hashOpaqueToken(raw),
      );
    });

    it('never leaks the raw token into its own hash', () => {
      const service = buildTokenService();
      const raw = 'a-fixed-raw-token-value-for-this-test';
      expect(service.hashOpaqueToken(raw)).not.toContain(raw);
    });
  });
});
