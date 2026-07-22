import { AuthTenant } from '../entities/auth-tenant.entity';
import { AuthUser } from '../entities/auth-user.entity';

export const REGISTRATION_REPOSITORY = Symbol('REGISTRATION_REPOSITORY');

export interface RegisterTenantOwnerInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  timezone: string;
}

export interface RegisterTenantOwnerResult {
  user: AuthUser;
  tenant: AuthTenant;
}

/**
 * A dedicated port for the one atomic, multi-table write this module needs
 * (docs/AUTH_SCHEMA_REVIEW.md / ADR-002 precedent: Tenant was pulled forward
 * specifically so this could exist). Deliberately narrower than a generic
 * "give me a transaction" port — exposing Prisma's `$transaction` client
 * through a domain port would leak infrastructure into the application
 * layer (SYSTEM_ARCHITECTURE.md Section 2.1). This composite operation
 * (Tenant + User + UserRole(OWNER), no TenantSettings/Subscription yet —
 * those tables don't exist until Milestone 3/8) is the only place that
 * matters this sprint, so it gets its own narrow, intention-revealing port.
 */
export interface RegistrationRepositoryPort {
  registerTenantOwner(
    input: RegisterTenantOwnerInput,
  ): Promise<RegisterTenantOwnerResult>;
}
