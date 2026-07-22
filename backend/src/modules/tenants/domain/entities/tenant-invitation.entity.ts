import { RoleName } from '@prisma/client';

export interface TenantInvitationEntity {
  id: string;
  tenantId: string;
  email: string;
  roleId: string;
  roleName: RoleName;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
