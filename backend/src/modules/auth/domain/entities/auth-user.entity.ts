import { RoleName } from '@prisma/client';

/**
 * The Auth module's own view of a user — decoupled from the Prisma model
 * (SYSTEM_ARCHITECTURE.md Section 2.1's Clean Architecture dependency rule:
 * domain/application never import Prisma types directly). Infrastructure
 * repositories map `PrismaClient`'s `User` rows into this shape.
 */
export interface AuthUser {
  id: string;
  tenantId: string | null;
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isEmailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: RoleName[];
}
