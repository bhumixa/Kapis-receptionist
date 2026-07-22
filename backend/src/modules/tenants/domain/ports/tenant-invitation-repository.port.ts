import { TenantInvitationEntity } from '../entities/tenant-invitation.entity';

export const TENANT_INVITATION_REPOSITORY = Symbol(
  'TENANT_INVITATION_REPOSITORY',
);

export interface CreateTenantInvitationInput {
  tenantId: string;
  email: string;
  roleId: string;
  invitedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface TenantInvitationRepositoryPort {
  findPendingByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantInvitationEntity | null>;
  create(input: CreateTenantInvitationInput): Promise<TenantInvitationEntity>;
  findPendingForTenant(tenantId: string): Promise<TenantInvitationEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<TenantInvitationEntity | null>;
  revoke(tenantId: string, id: string): Promise<void>;
  /** No tenant scoping — the token itself is the credential (mirrors `EmailVerification`/`PasswordReset`). */
  findByTokenHash(tokenHash: string): Promise<TenantInvitationEntity | null>;
  markAccepted(id: string): Promise<void>;
}
