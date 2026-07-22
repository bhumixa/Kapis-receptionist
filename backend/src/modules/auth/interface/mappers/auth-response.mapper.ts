import { AuthTenant } from '../../domain/entities/auth-tenant.entity';
import { AuthUser } from '../../domain/entities/auth-user.entity';
import { TenantResponseDto } from '../dto/tenant-response.dto';
import { UserResponseDto } from '../dto/user-response.dto';

export function toUserResponseDto(user: AuthUser): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toTenantResponseDto(tenant: AuthTenant): TenantResponseDto {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    timezone: tenant.timezone,
    addressLine1: tenant.addressLine1,
    city: tenant.city,
    countryCode: tenant.countryCode,
    defaultLocale: tenant.defaultLocale,
    logoUrl: null,
    trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
    createdAt: tenant.createdAt.toISOString(),
  };
}
