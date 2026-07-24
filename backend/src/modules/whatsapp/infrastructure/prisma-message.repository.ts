import { Injectable } from '@nestjs/common';
import {
  Message as PrismaMessageModel,
  MessageDeliveryStatus,
} from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { cursorWhereClause } from '../../../common/utils/cursor-pagination.util';
import { MessageEntity } from '../domain/entities/message.entity';
import {
  CreateMessageInput,
  MessageListFilter,
  MessageRepositoryPort,
} from '../domain/ports/message-repository.port';
import { toMessageEntity } from './mappers/prisma-whatsapp.mappers';

@Injectable()
export class PrismaMessageRepository
  extends TenantScopedRepository<PrismaMessageModel>
  implements MessageRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.message as unknown as TenantScopedDelegate;
  }

  async findList(
    tenantId: string,
    filter: MessageListFilter,
  ): Promise<MessageEntity[]> {
    const where = {
      tenantId,
      conversationId: filter.conversationId,
      ...cursorWhereClause('createdAt', filter.sortDirection, filter.cursor),
    };

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [
        { createdAt: filter.sortDirection },
        { id: filter.sortDirection },
      ],
      take: filter.limit + 1,
    });

    return rows.map(toMessageEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<MessageEntity | null> {
    const row = await this.findFirstForTenant(tenantId, { id });
    return row ? toMessageEntity(row) : null;
  }

  async findByWhatsappMessageId(
    whatsappMessageId: string,
  ): Promise<MessageEntity | null> {
    const row = await this.prisma.message.findFirst({
      where: { whatsappMessageId },
    });
    return row ? toMessageEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateMessageInput,
  ): Promise<MessageEntity> {
    const row = await this.createForTenant(tenantId, {
      conversationId: input.conversationId,
      direction: input.direction,
      senderType: input.senderType,
      senderId: input.senderId ?? null,
      messageType: input.messageType,
      content: input.content ?? null,
      mediaWhatsappId: input.mediaWhatsappId ?? null,
      mediaMimeType: input.mediaMimeType ?? null,
      mediaSha256: input.mediaSha256 ?? null,
      mediaFilename: input.mediaFilename ?? null,
      mediaSizeBytes: input.mediaSizeBytes ?? null,
      whatsappMessageId: input.whatsappMessageId ?? null,
      status: input.status,
      sourceWebhookEventId: input.sourceWebhookEventId ?? null,
    });
    return toMessageEntity(row);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: MessageDeliveryStatus,
    failureReason?: string | null,
  ): Promise<MessageEntity> {
    const row = await this.updateForTenant(tenantId, id, {
      status,
      ...(failureReason !== undefined ? { failureReason } : {}),
    });
    return toMessageEntity(row);
  }

  async updateStatusByWhatsappMessageId(
    whatsappMessageId: string,
    status: MessageDeliveryStatus,
  ): Promise<void> {
    await this.prisma.message.updateMany({
      where: { whatsappMessageId },
      data: { status },
    });
  }

  async setWhatsappMessageId(
    tenantId: string,
    id: string,
    whatsappMessageId: string,
  ): Promise<void> {
    await this.updateForTenant(tenantId, id, { whatsappMessageId });
  }
}
