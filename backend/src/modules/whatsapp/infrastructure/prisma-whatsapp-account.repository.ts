import { Injectable } from '@nestjs/common';
import {
  WhatsAppAccount as PrismaWhatsAppAccountModel,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { WhatsAppAccountEntity } from '../domain/entities/whatsapp-account.entity';
import {
  ConnectWhatsAppAccountInput,
  WhatsAppAccountRepositoryPort,
} from '../domain/ports/whatsapp-account-repository.port';
import { toWhatsAppAccountEntity } from './mappers/prisma-whatsapp.mappers';

@Injectable()
export class PrismaWhatsAppAccountRepository
  extends TenantScopedRepository<PrismaWhatsAppAccountModel>
  implements WhatsAppAccountRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.whatsAppAccount as unknown as TenantScopedDelegate;
  }

  async findByTenantId(
    tenantId: string,
  ): Promise<WhatsAppAccountEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {});
    return row ? toWhatsAppAccountEntity(row) : null;
  }

  async findByPhoneNumberId(
    whatsappPhoneNumberId: string,
  ): Promise<WhatsAppAccountEntity | null> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { whatsappPhoneNumberId },
    });
    return row ? toWhatsAppAccountEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: ConnectWhatsAppAccountInput,
  ): Promise<WhatsAppAccountEntity> {
    const row = await this.createForTenant(tenantId, {
      phoneNumber: input.phoneNumber,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      whatsappBusinessAccountId: input.whatsappBusinessAccountId,
      accessTokenEncrypted: input.accessTokenEncrypted,
      connectionStatus: WhatsAppConnectionStatus.CONNECTED,
      connectedAt: new Date(),
    });
    return toWhatsAppAccountEntity(row);
  }

  async updateConnectionStatus(
    tenantId: string,
    status: WhatsAppConnectionStatus,
    extra?: { connectedAt?: Date; disconnectedAt?: Date },
  ): Promise<WhatsAppAccountEntity> {
    const existing = await this.findFirstForTenant(tenantId, {});
    if (!existing) {
      throw new Error('WhatsAppAccount not found for tenant');
    }
    const row = await this.updateForTenant(tenantId, existing.id, {
      connectionStatus: status,
      ...(extra?.connectedAt ? { connectedAt: extra.connectedAt } : {}),
      ...(extra?.disconnectedAt
        ? { disconnectedAt: extra.disconnectedAt }
        : {}),
    });
    return toWhatsAppAccountEntity(row);
  }
}
