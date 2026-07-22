import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { SalonProfileEntity } from '../domain/entities/salon-profile.entity';
import {
  SalonProfileRepositoryPort,
  UpdateSalonProfileFields,
} from '../domain/ports/salon-profile-repository.port';
import { toSalonProfileEntity } from './mappers/prisma-salon.mappers';

/**
 * Not a `TenantScopedRepository` subclass — `SalonProfile` is a 1:1 record
 * keyed by `tenantId`, mirroring `PrismaTenantSettingsRepository`'s same
 * rationale, not "many rows per tenant" the base class targets.
 */
@Injectable()
export class PrismaSalonProfileRepository implements SalonProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string): Promise<SalonProfileEntity | null> {
    const row = await this.prisma.salonProfile.findUnique({
      where: { tenantId },
    });
    return row ? toSalonProfileEntity(row) : null;
  }

  async createDefault(tenantId: string): Promise<SalonProfileEntity> {
    const row = await this.prisma.salonProfile.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
    return toSalonProfileEntity(row);
  }

  async upsert(
    tenantId: string,
    fields: UpdateSalonProfileFields,
    tx?: Prisma.TransactionClient,
  ): Promise<SalonProfileEntity> {
    const row = await (tx ?? this.prisma).salonProfile.upsert({
      where: { tenantId },
      update: fields,
      create: { tenantId, ...fields },
    });
    return toSalonProfileEntity(row);
  }
}
