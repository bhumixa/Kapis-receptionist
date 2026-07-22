import {
  Tenant as PrismaTenant,
  TenantInvitation as PrismaTenantInvitation,
  TenantSettings as PrismaTenantSettings,
  Role as PrismaRole,
} from '@prisma/client';
import { TenantEntity } from '../../domain/entities/tenant.entity';
import {
  EMPTY_TENANT_SETTINGS_CATEGORIES,
  TenantSettingsEntity,
} from '../../domain/entities/tenant-settings.entity';
import { TenantInvitationEntity } from '../../domain/entities/tenant-invitation.entity';

export function toTenantEntity(row: PrismaTenant): TenantEntity {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timezone: row.timezone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    countryCode: row.countryCode,
    defaultLocale: row.defaultLocale,
    trialEndsAt: row.trialEndsAt,
    suspendedAt: row.suspendedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTenantSettingsEntity(
  row: PrismaTenantSettings,
): TenantSettingsEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    general: asRecord(row.general),
    localization: asRecord(row.localization),
    business: asRecord(row.business),
    notifications: asRecord(row.notifications),
    security: asRecord(row.security),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { ...EMPTY_TENANT_SETTINGS_CATEGORIES.general };
}

export function toTenantInvitationEntity(
  row: PrismaTenantInvitation & { role: PrismaRole },
): TenantInvitationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    roleId: row.roleId,
    roleName: row.role.name,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
