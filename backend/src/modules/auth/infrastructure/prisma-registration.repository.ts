import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { slugify, withRandomSuffix } from '../../../common/utils/slugify.util';
import { AuthUser } from '../domain/entities/auth-user.entity';
import {
  RegisterInvitedUserInput,
  RegisterTenantOwnerInput,
  RegisterTenantOwnerResult,
  RegistrationRepositoryPort,
} from '../domain/ports/registration-repository.port';
import {
  toAuthTenant,
  toAuthUser,
  userWithRolesInclude,
} from './mappers/prisma-auth.mappers';

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Implements the one atomic, multi-table write this module owns: Tenant +
 * User + UserRole(OWNER) + TenantSettings in a single Postgres transaction
 * (SYSTEM_ARCHITECTURE.md Section 2.2's "Modular Monolith gives ACID
 * transactions" rationale, applied here). As of Milestone 3
 * (docs/adr/ADR-006), `TenantSettings` is created here with its default,
 * empty namespace values — but deliberately **not** `Subscription`, since
 * that table still doesn't exist (Milestone 8/Billing, explicitly out of
 * this milestone's scope; `Tenant.status`/`trialEndsAt` continue to work
 * exactly as before). Does **not** send a verification email — that's
 * orchestrated by `AuthService.register` after this transaction commits.
 */
@Injectable()
export class PrismaRegistrationRepository implements RegistrationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async registerTenantOwner(
    input: RegisterTenantOwnerInput,
  ): Promise<RegisterTenantOwnerResult> {
    const baseSlug = slugify(input.tenantName) || 'salon';
    let slug = baseSlug;

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.attemptRegistration(input, slug);
      } catch (error) {
        if (isUniqueConstraintViolation(error, 'slug')) {
          slug = withRandomSuffix(baseSlug);
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'Could not generate a unique tenant slug after several attempts.',
    );
  }

  private async attemptRegistration(
    input: RegisterTenantOwnerInput,
    slug: string,
  ): Promise<RegisterTenantOwnerResult> {
    const { user, tenant } = await this.prisma.$transaction(async (tx) => {
      const ownerRole = await tx.role.findUnique({
        where: { name: RoleName.OWNER },
      });
      if (!ownerRole) {
        // Seeded reference data (Milestone 1) — its absence is a genuine
        // configuration error, not a user-facing validation failure.
        throw new InternalServerErrorException(
          'OWNER role is not seeded; cannot complete registration.',
        );
      }

      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          slug,
          timezone: input.timezone,
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          roles: {
            create: { roleId: ownerRole.id },
          },
        },
        include: { roles: { include: { role: true } } },
      });

      await tx.tenantSettings.create({ data: { tenantId: tenant.id } });

      return { user, tenant };
    });

    return { user: toAuthUser(user), tenant: toAuthTenant(tenant) };
  }

  async registerInvitedUser(
    input: RegisterInvitedUserInput,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.create({
      data: {
        tenantId: input.tenantId,
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        // The invitation link itself is the verification mechanism — the
        // invitee clicked an emailed, tenant-scoped, single-use link, which
        // is at least as strong a proof of email ownership as this
        // platform's standard verify-email flow. No redundant second
        // verification email is sent.
        isEmailVerified: true,
        roles: { create: { roleId: input.roleId } },
      },
      include: userWithRolesInclude,
    });

    return toAuthUser(user);
  }
}

function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes(field)
  );
}
