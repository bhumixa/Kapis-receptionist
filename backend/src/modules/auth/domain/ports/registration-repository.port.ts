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

export interface RegisterInvitedUserInput {
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

/**
 * A dedicated port for the one atomic, multi-table write this module needs
 * (docs/AUTH_SCHEMA_REVIEW.md / ADR-002 precedent: Tenant was pulled forward
 * specifically so this could exist). Deliberately narrower than a generic
 * "give me a transaction" port — exposing Prisma's `$transaction` client
 * through a domain port would leak infrastructure into the application
 * layer (SYSTEM_ARCHITECTURE.md Section 2.1). This composite operation
 * (Tenant + User + UserRole(OWNER) + TenantSettings, no `Subscription` yet
 * — that table doesn't exist until Milestone 8/Billing) is the only place
 * that matters for self-registration.
 *
 * `registerInvitedUser` (Milestone 3, docs/adr/ADR-006) is the accept-
 * invitation counterpart: User + UserRole for an *existing* tenant, no new
 * `Tenant`/`TenantSettings` row. `AuthService.acceptInvitation` calls
 * `TenantsModule`'s `TenantInvitationService.validateAndConsume` first (to
 * get `tenantId`/`roleId`/`email`), then this, then
 * `TenantInvitationService.markAccepted` — see that service's doc comment
 * for the narrow, accepted edge case this three-step (not single-
 * transaction) sequence leaves open.
 */
export interface RegistrationRepositoryPort {
  registerTenantOwner(
    input: RegisterTenantOwnerInput,
  ): Promise<RegisterTenantOwnerResult>;
  registerInvitedUser(input: RegisterInvitedUserInput): Promise<AuthUser>;
}
