/**
 * The Auth module's own view of an `EmailVerification` row. `tokenHash` is
 * a plain SHA-256 digest of the opaque raw token (TokenService) — the raw
 * token itself is never persisted (PRISMA_SCHEMA.md Section 3.1).
 */
export interface EmailVerificationRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}
