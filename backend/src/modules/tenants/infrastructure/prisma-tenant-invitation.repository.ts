import { Injectable } from '@nestjs/common';
import { Role, TenantInvitation } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { TenantInvitationEntity } from '../domain/entities/tenant-invitation.entity';
import {
  CreateTenantInvitationInput,
  TenantInvitationRepositoryPort,
} from '../domain/ports/tenant-invitation-repository.port';
import { toTenantInvitationEntity } from './mappers/prisma-tenant.mappers';

type RowWithRole = TenantInvitation & { role: Role };

const ROLE_INCLUDE = { role: true } as const;

@Injectable()
export class PrismaTenantInvitationRepository
  extends TenantScopedRepository<RowWithRole>
  implements TenantInvitationRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.tenantInvitation as unknown as TenantScopedDelegate;
  }

  async findPendingByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantInvitationEntity | null> {
    const row = await this.findFirstForTenant(
      tenantId,
      { email, acceptedAt: null, revokedAt: null },
      ROLE_INCLUDE,
    );
    return row ? toTenantInvitationEntity(row) : null;
  }

  async create(
    input: CreateTenantInvitationInput,
  ): Promise<TenantInvitationEntity> {
    const row = await this.prisma.tenantInvitation.create({
      data: {
        tenantId: input.tenantId,
        email: input.email,
        roleId: input.roleId,
        invitedByUserId: input.invitedByUserId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
      include: ROLE_INCLUDE,
    });
    return toTenantInvitationEntity(row);
  }

  async findPendingForTenant(
    tenantId: string,
  ): Promise<TenantInvitationEntity[]> {
    const rows = await this.findManyForTenant(
      tenantId,
      { acceptedAt: null, revokedAt: null },
      { include: ROLE_INCLUDE, orderBy: { createdAt: 'desc' } },
    );
    return rows.map(toTenantInvitationEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<TenantInvitationEntity | null> {
    const row = await this.findFirstForTenant(tenantId, { id }, ROLE_INCLUDE);
    return row ? toTenantInvitationEntity(row) : null;
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    await this.updateForTenant(tenantId, id, { revokedAt: new Date() });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<TenantInvitationEntity | null> {
    const row = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash },
      include: ROLE_INCLUDE,
    });
    return row ? toTenantInvitationEntity(row) : null;
  }

  async markAccepted(id: string): Promise<void> {
    await this.prisma.tenantInvitation.update({
      where: { id },
      data: { acceptedAt: new Date() },
    });
  }
}
