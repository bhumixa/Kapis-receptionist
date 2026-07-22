import { AuthUser } from '../entities/auth-user.entity';

/**
 * Port (Clean Architecture, SYSTEM_ARCHITECTURE.md Section 2.1) the
 * application layer depends on; `infrastructure/prisma-user.repository.ts`
 * is the only implementation. Read-only — user creation is part of the
 * atomic registration write-unit, see `registration-repository.port.ts`.
 */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepositoryPort {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  updateLastLoginAt(id: string, when: Date): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}
