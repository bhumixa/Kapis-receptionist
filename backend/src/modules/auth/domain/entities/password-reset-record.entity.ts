/** The Auth module's own view of a `PasswordReset` row (see email-verification-record.entity.ts note). */
export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}
