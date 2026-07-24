import { WebhookProcessingStatus } from '@prisma/client';

/**
 * The raw, global ingestion log (Milestone 7) — persisted synchronously by
 * `WebhookIngestionService` before any processing, even when signature
 * verification fails, so a spoofing attempt is forensically visible rather
 * than silently dropped (API_SPECIFICATION.md Section 2.12).
 * `tenantId` is nullable — resolved asynchronously by the inbound queue
 * worker via `whatsappPhoneNumberId` lookup, not at ingestion time.
 */
export interface WebhookEventEntity {
  id: string;
  tenantId: string | null;
  whatsappMessageId: string | null;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
  processingStatus: WebhookProcessingStatus;
  processedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}
