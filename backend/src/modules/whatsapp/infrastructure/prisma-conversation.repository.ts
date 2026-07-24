import { Injectable } from '@nestjs/common';
import {
  Conversation as PrismaConversationModel,
  ConversationStatus,
  Prisma,
} from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { cursorWhereClause } from '../../../common/utils/cursor-pagination.util';
import { ConversationEntity } from '../domain/entities/conversation.entity';
import {
  ConversationListFilter,
  ConversationRepositoryPort,
  CreateConversationInput,
} from '../domain/ports/conversation-repository.port';
import { toConversationEntity } from './mappers/prisma-whatsapp.mappers';

@Injectable()
export class PrismaConversationRepository
  extends TenantScopedRepository<PrismaConversationModel>
  implements ConversationRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.conversation as unknown as TenantScopedDelegate;
  }

  async findList(
    tenantId: string,
    filter: ConversationListFilter,
  ): Promise<ConversationEntity[]> {
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(filter.statusIn?.length ? { status: { in: filter.statusIn } } : {}),
      ...cursorWhereClause(
        'lastMessageAt',
        filter.sortDirection,
        filter.cursor,
      ),
    };

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [
        { lastMessageAt: filter.sortDirection },
        { id: filter.sortDirection },
      ],
      take: filter.limit + 1,
    });

    return rows.map(toConversationEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ConversationEntity | null> {
    const row = await this.findFirstForTenant(tenantId, { id });
    return row ? toConversationEntity(row) : null;
  }

  async findMostRecentOpenByCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<ConversationEntity | null> {
    const row = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId, status: ConversationStatus.OPEN },
      orderBy: { lastMessageAt: 'desc' },
    });
    return row ? toConversationEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateConversationInput,
  ): Promise<ConversationEntity> {
    const row = await this.createForTenant(tenantId, {
      customerId: input.customerId,
      whatsappAccountId: input.whatsappAccountId,
    });
    return toConversationEntity(row);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationEntity> {
    const now = new Date();
    const row = await this.updateForTenant(tenantId, id, {
      status,
      ...(status === ConversationStatus.RESOLVED ? { resolvedAt: now } : {}),
      ...(status === ConversationStatus.CLOSED ? { closedAt: now } : {}),
    });
    return toConversationEntity(row);
  }

  async assignUser(
    tenantId: string,
    id: string,
    userId: string | null,
  ): Promise<ConversationEntity> {
    const row = await this.updateForTenant(tenantId, id, {
      assignedUserId: userId,
    });
    return toConversationEntity(row);
  }

  async touchLastMessage(
    tenantId: string,
    id: string,
    occurredAt: Date,
    isInbound: boolean,
  ): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id, tenantId },
      data: {
        lastMessageAt: occurredAt,
        ...(isInbound ? { lastInboundMessageAt: occurredAt } : {}),
      },
    });
  }
}
