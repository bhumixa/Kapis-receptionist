import { Injectable } from '@nestjs/common';
import { Prisma, WebhookProcessingStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { WebhookLogEntity } from '../domain/entities/webhook-log.entity';
import {
  CreateWebhookLogInput,
  WebhookLogRepositoryPort,
} from '../domain/ports/webhook-log-repository.port';
import { toWebhookLogEntity } from './mappers/prisma-billing.mappers';

/**
 * Deliberately does not extend `TenantScopedRepository` — `WebhookLog` is a
 * global ingestion log (`tenantId` nullable, resolved asynchronously), not a
 * tenant-owned business record (same precedent as WhatsApp's `WebhookEvent`).
 */
@Injectable()
export class PrismaWebhookLogRepository implements WebhookLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateWebhookLogInput): Promise<WebhookLogEntity> {
    const row = await this.prisma.webhookLog.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        tenantId: input.tenantId,
      },
    });
    return toWebhookLogEntity(row);
  }

  async findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookLogEntity | null> {
    const row = await this.prisma.webhookLog.findUnique({
      where: {
        uq_webhook_logs_provider_event: { provider, providerEventId },
      },
    });
    return row ? toWebhookLogEntity(row) : null;
  }

  async findById(id: string): Promise<WebhookLogEntity | null> {
    const row = await this.prisma.webhookLog.findUnique({ where: { id } });
    return row ? toWebhookLogEntity(row) : null;
  }

  async updateStatus(
    id: string,
    status: WebhookProcessingStatus,
    extra?: { tenantId?: string; errorMessage?: string },
  ): Promise<void> {
    await this.prisma.webhookLog.update({
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
