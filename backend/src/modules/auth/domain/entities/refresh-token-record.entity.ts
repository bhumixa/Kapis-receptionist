/**
 * The Auth module's own view of a `RefreshToken` row. `refreshTokenHash` is
 * an HMAC-SHA256 digest of the opaque raw token (SessionService/TokenService)
 * — the raw token itself is never persisted anywhere (PRISMA_SCHEMA.md
 * Section 3.1).
 */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  createdAt: Date;
}
