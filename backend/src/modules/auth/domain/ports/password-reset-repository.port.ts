import { PasswordResetRecord } from '../entities/password-reset-record.entity';

export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY');

export interface CreatePasswordResetInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface PasswordResetRepositoryPort {
  create(input: CreatePasswordResetInput): Promise<PasswordResetRecord>;
  findByHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  markUsed(id: string): Promise<void>;
  /** Invalidates every unused reset token for a user (superseded by a fresh request). */
  invalidateActiveForUser(userId: string): Promise<void>;
}
