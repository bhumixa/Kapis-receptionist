import { Prisma, Tenant } from '@prisma/client';
import { AuthTenant } from '../../domain/entities/auth-tenant.entity';
import { AuthUser } from '../../domain/entities/auth-user.entity';

/** Every place a `User` is loaded for the Auth module includes its roles this way. */
export const userWithRolesInclude = {
  roles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{
  include: typeof userWithRolesInclude;
}>;

export function toAuthUser(user: UserWithRoles): AuthUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    passwordHash: user.passwordHash,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    roles: user.roles.map((userRole) => userRole.role.name),
  };
}

export function toAuthTenant(tenant: Tenant): AuthTenant {
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
    trialEndsAt: tenant.trialEndsAt,
    createdAt: tenant.createdAt,
  };
}
