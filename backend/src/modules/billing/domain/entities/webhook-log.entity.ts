import { WebhookProcessingStatus } from '@prisma/client';

/**
 * The Stripe analogue of `WebhookEvent` (WhatsApp) — persisted synchronously
 * by `WebhookIngestionService` before any processing, even when signature
 * verification fails, so a spoofing attempt is forensically visible rather
 * than silently dropped. `tenantId` is nullable — resolved asynchronously by
 * the queue worker via `stripeCustomerId` lookup, not at ingestion time.
 */
export interface WebhookLogEntity {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  tenantId: string | null;
  processingStatus: WebhookProcessingStatus;
  processedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}
