import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { PrismaService } from '../../../database/prisma.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantEntity } from '../../tenants/domain/entities/tenant.entity';
import { TenantService } from '../../tenants/application/tenant.service';
import { SalonProfileEntity } from '../domain/entities/salon-profile.entity';
import {
  SALON_PROFILE_REPOSITORY,
  type SalonProfileRepositoryPort,
  type UpdateSalonProfileFields,
} from '../domain/ports/salon-profile-repository.port';

/**
 * The composed `GET /salon` read shape: `Tenant`'s existing identity fields
 * (owned by `modules/tenants`, unchanged since Milestone 3) merged with
 * this milestone's new `SalonProfile` fields. Never persisted as its own
 * row — always assembled on read (docs/adr/ADR-007-salon-management.md).
 */
export interface SalonProfileView {
  tenantId: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  countryCode: string | null;
  timezone: string;
  defaultLocale: string;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  currency: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  updatedAt: Date;
}

/** All fields optional — `PATCH /salon`'s request shape spans both Tenant- and SalonProfile-owned fields. */
export interface UpdateSalonProfileInput {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  countryCode?: string;
  timezone?: string;
  defaultLocale?: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  currency?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

const TENANT_FIELD_KEYS = [
  'name',
  'addressLine1',
  'addressLine2',
  'city',
  'countryCode',
  'timezone',
  'defaultLocale',
] as const;

const SALON_PROFILE_FIELD_KEYS = [
  'description',
  'contactEmail',
  'contactPhone',
  'website',
  'currency',
  'logoUrl',
  'primaryColor',
  'secondaryColor',
] as const;

/**
 * `GET/PATCH /salon` (docs/SALON_ARCHITECTURE.md). Composes `Tenant` (owned
 * by `modules/tenants`, reached only through its exported `TenantService`
 * per the module-boundary rule — never this module's own Prisma access)
 * with the new `SalonProfile` satellite table this milestone introduces.
 *
 * `PATCH /salon` splits its input into the Tenant-owned subset and the
 * SalonProfile-owned subset and writes both atomically in one
 * `prisma.$transaction`, so a combined update can't partially apply.
 * `TenantService.updateProfile`/`AuditLogService.record` both accept an
 * optional trailing `tx` for exactly this composition (both changes are
 * this milestone's one deliberate touch to Milestone 3 code).
 */
@Injectable()
export class SalonProfileService {
  constructor(
    @Inject(SALON_PROFILE_REPOSITORY)
    private readonly profiles: SalonProfileRepositoryPort,
    private readonly tenantService: TenantService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  async getProfile(tenantId: string): Promise<SalonProfileView> {
    const [tenant, profile] = await Promise.all([
      this.tenantService.getProfile(tenantId),
      this.getOrCreateProfile(tenantId),
    ]);
    return composeView(tenant, profile);
  }

  async updateProfile(
    tenantId: string,
    actor: AccessTokenPayload,
    input: UpdateSalonProfileInput,
  ): Promise<SalonProfileView> {
    const { tenantFields, profileFields } = splitUpdateInput(input);
    const hasTenantFields = Object.keys(tenantFields).length > 0;
    const hasProfileFields = Object.keys(profileFields).length > 0;

    if (!hasTenantFields && !hasProfileFields) {
      return this.getProfile(tenantId);
    }

    await this.prisma.$transaction(async (tx) => {
      if (hasTenantFields) {
        await this.tenantService.updateProfile(
          tenantId,
          actor,
          tenantFields,
          tx,
        );
      }
      if (hasProfileFields) {
        await this.profiles.upsert(tenantId, profileFields, tx);
      }
    });

    await this.auditLog.record({
      action: 'SALON_PROFILE_UPDATED',
      entityType: 'SalonProfile',
      entityId: tenantId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return this.getProfile(tenantId);
  }

  private async getOrCreateProfile(
    tenantId: string,
  ): Promise<SalonProfileEntity> {
    const existing = await this.profiles.findByTenantId(tenantId);
    if (existing) {
      return existing;
    }
    return this.profiles.createDefault(tenantId);
  }
}

function splitUpdateInput(input: UpdateSalonProfileInput): {
  tenantFields: Partial<UpdateSalonProfileInput>;
  profileFields: UpdateSalonProfileFields;
} {
  const tenantFields: Partial<UpdateSalonProfileInput> = {};
  for (const key of TENANT_FIELD_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      (tenantFields as Record<string, unknown>)[key] = value;
    }
  }

  const profileFields: UpdateSalonProfileFields = {};
  for (const key of SALON_PROFILE_FIELD_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      (profileFields as Record<string, unknown>)[key] = value;
    }
  }

  return { tenantFields, profileFields };
}

function composeView(
  tenant: TenantEntity,
  profile: SalonProfileEntity,
): SalonProfileView {
  return {
    tenantId: tenant.id,
    name: tenant.name,
    addressLine1: tenant.addressLine1,
    addressLine2: tenant.addressLine2,
    city: tenant.city,
    countryCode: tenant.countryCode,
    timezone: tenant.timezone,
    defaultLocale: tenant.defaultLocale,
    description: profile.description,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    website: profile.website,
    currency: profile.currency,
    logoUrl: profile.logoUrl,
    primaryColor: profile.primaryColor,
    secondaryColor: profile.secondaryColor,
    updatedAt:
      tenant.updatedAt.getTime() > profile.updatedAt.getTime()
        ? tenant.updatedAt
        : profile.updatedAt,
  };
}
