import { WebhookProcessingStatus } from '@prisma/client';
import { WebhookLogEntity } from '../entities/webhook-log.entity';

export const WEBHOOK_LOG_REPOSITORY = Symbol('WEBHOOK_LOG_REPOSITORY');

export interface CreateWebhookLogInput {
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  tenantId: string | null;
}

export interface WebhookLogRepositoryPort {
  create(input: CreateWebhookLogInput): Promise<WebhookLogEntity>;
  findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookLogEntity | null>;
  findById(id: string): Promise<WebhookLogEntity | null>;
  updateStatus(
    id: string,
    status: WebhookProcessingStatus,
    extra?: { tenantId?: string; errorMessage?: string },
  ): Promise<void>;
}
