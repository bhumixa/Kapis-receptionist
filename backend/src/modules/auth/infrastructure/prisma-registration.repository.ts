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
 * User + UserRole(OWNER) + TenantSettings + Subscription in a single
 * Postgres transaction (SYSTEM_ARCHITECTURE.md Section 2.2's "Modular
 * Monolith gives ACID transactions" rationale, applied here). Does **not**
 * send a verification email — that's orchestrated by `AuthService.register`
 * after this transaction commits.
 *
 * Milestone 9 (docs/BILLING_ARCHITECTURE.md): also creates a `TRIALING`
 * `Subscription` against the cheapest active `Plan`, in the same
 * transaction. This is a plain Prisma write directly against `tx.subscription`
 * — not a call into `modules/billing`'s `SubscriptionsService` — deliberately,
 * to avoid making `AuthModule` depend on `BillingModule` (which would create
 * a circular module dependency, since `BillingModule` itself needs
 * `AuthModule`/`CoreModule` like every other module). It also needs no
 * Stripe call: `Subscription.stripeCustomerId` is nullable by design (see
 * that model's own schema doc comment) — a real Stripe Customer is created
 * lazily, on first Checkout. `Tenant.trialEndsAt` (already existed since
 * Milestone 2) is set to match, so `GET /tenant` continues to reflect trial
 * status without a join.
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

      const defaultPlan = await tx.plan.findFirst({
        where: { isActive: true },
        orderBy: { monthlyPriceCents: 'asc' },
      });
      if (!defaultPlan) {
        // A platform configuration gap (no active Plan seeded), not a
        // per-signup problem — same "fail loudly on an ops mistake, don't
        // silently skip billing setup" stance as the OWNER-role check above.
        throw new InternalServerErrorException(
          'No active Plan is configured; cannot complete registration.',
        );
      }

      const now = new Date();
      const trialEndsAt = new Date(
        now.getTime() + defaultPlan.trialDays * 24 * 60 * 60 * 1000,
      );
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: defaultPlan.id,
          status: 'TRIALING',
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
        },
      });
      const tenantWithTrial = await tx.tenant.update({
        where: { id: tenant.id },
        data: { trialEndsAt },
      });

      return { user, tenant: tenantWithTrial };
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
