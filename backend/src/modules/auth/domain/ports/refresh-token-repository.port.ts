import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

export interface CreateRefreshTokenInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface RefreshTokenRepositoryPort {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findByHash(refreshTokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marks a single session revoked, optionally linking it to its rotated successor. */
  revoke(id: string, replacedBySessionId?: string): Promise<void>;
  /** Reuse-detection / logout-all-devices response — revokes every currently-active session for the user. */
  revokeAllActiveForUser(userId: string): Promise<number>;
}
