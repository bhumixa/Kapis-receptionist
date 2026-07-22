import { EmailVerificationRecord } from '../entities/email-verification-record.entity';

export const EMAIL_VERIFICATION_REPOSITORY = Symbol(
  'EMAIL_VERIFICATION_REPOSITORY',
);

export interface CreateEmailVerificationInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface EmailVerificationRepositoryPort {
  create(input: CreateEmailVerificationInput): Promise<EmailVerificationRecord>;
  findByHash(tokenHash: string): Promise<EmailVerificationRecord | null>;
  markVerified(id: string): Promise<void>;
  /** Invalidates every unverified token for a user (superseded by a fresh resend). */
  invalidateActiveForUser(userId: string): Promise<void>;
}
