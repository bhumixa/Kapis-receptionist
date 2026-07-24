import { WebhookProcessingStatus } from '@prisma/client';
import { WebhookEventEntity } from '../entities/webhook-event.entity';

export const WEBHOOK_EVENT_REPOSITORY = Symbol('WEBHOOK_EVENT_REPOSITORY');

export interface CreateWebhookEventInput {
  tenantId: string | null;
  whatsappMessageId: string | null;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
}

export interface WebhookEventRepositoryPort {
  create(input: CreateWebhookEventInput): Promise<WebhookEventEntity>;
  findById(id: string): Promise<WebhookEventEntity | null>;
  updateStatus(
    id: string,
    status: WebhookProcessingStatus,
    extra?: { tenantId?: string; errorMessage?: string },
  ): Promise<void>;
}
