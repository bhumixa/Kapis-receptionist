import { TenantSettingsEntity } from '../../domain/entities/tenant-settings.entity';
import { TenantInvitationEntity } from '../../domain/entities/tenant-invitation.entity';
import { TenantSettingsResponseDto } from '../dto/tenant-settings-response.dto';
import { InvitationResponseDto } from '../dto/invitation-response.dto';

export function toTenantSettingsResponseDto(
  settings: TenantSettingsEntity,
): TenantSettingsResponseDto {
  return {
    general: settings.general,
    localization: settings.localization,
    business: settings.business,
    notifications: settings.notifications,
    security: settings.security,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function toInvitationResponseDto(
  invitation: TenantInvitationEntity,
): InvitationResponseDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.roleName,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
