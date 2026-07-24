import { Injectable } from '@nestjs/common';
import { Prisma, WebhookProcessingStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { WebhookEventEntity } from '../domain/entities/webhook-event.entity';
import {
  CreateWebhookEventInput,
  WebhookEventRepositoryPort,
} from '../domain/ports/webhook-event-repository.port';
import { toWebhookEventEntity } from './mappers/prisma-whatsapp.mappers';

/**
 * Deliberately does not extend `TenantScopedRepository` — `WebhookEvent` is
 * a global ingestion log (`tenantId` nullable, resolved asynchronously),
 * not a tenant-owned business record. Every write here is either tenant-less
 * (creation, before resolution) or keyed by the event's own `id`, never by
 * `(tenantId, id)`.
 */
@Injectable()
export class PrismaWebhookEventRepository implements WebhookEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateWebhookEventInput): Promise<WebhookEventEntity> {
    const row = await this.prisma.webhookEvent.create({
      data: {
        tenantId: input.tenantId,
        whatsappMessageId: input.whatsappMessageId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        signatureValid: input.signatureValid,
      },
    });
    return toWebhookEventEntity(row);
  }

  async findById(id: string): Promise<WebhookEventEntity | null> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } });
    return row ? toWebhookEventEntity(row) : null;
  }

  async updateStatus(
    id: string,
    status: WebhookProcessingStatus,
    extra?: { tenantId?: string; errorMessage?: string },
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        processingStatus: status,
        processedAt: new Date(),
        ...(extra?.tenantId ? { tenantId: extra.tenantId } : {}),
        ...(extra?.errorMessage !== undefined
          ? { errorMessage: extra.errorMessage }
          : {}),
      },
    });
  }
}
