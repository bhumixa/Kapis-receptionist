import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { slugify, withRandomSuffix } from '../../../common/utils/slugify.util';
import {
  RegisterTenantOwnerInput,
  RegisterTenantOwnerResult,
  RegistrationRepositoryPort,
} from '../domain/ports/registration-repository.port';
import { toAuthTenant, toAuthUser } from './mappers/prisma-auth.mappers';

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Implements the one atomic, multi-table write this module owns: Tenant +
 * User + UserRole(OWNER) in a single Postgres transaction
 * (SYSTEM_ARCHITECTURE.md Section 2.2's "Modular Monolith gives ACID
 * transactions" rationale, applied here). Deliberately does **not** create
 * `TenantSettings`/`Subscription` — those tables don't exist until
 * Milestone 3/8 (docs/AUTH_SCHEMA_REVIEW.md Section 3, ADR-002), and does
 * **not** send a verification email (Notifications/email-verification are
 * out of this sprint's scope, docs/adr/ADR-003-core-authentication.md).
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

      return { user, tenant };
    });

    return { user: toAuthUser(user), tenant: toAuthTenant(tenant) };
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
