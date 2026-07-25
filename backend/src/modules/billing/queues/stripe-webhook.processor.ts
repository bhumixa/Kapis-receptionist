import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StripeEventProcessorService } from '../application/stripe-event-processor.service';
import {
  STRIPE_WEBHOOK_QUEUE,
  type StripeWebhookJobData,
} from './billing-queue.constants';

/**
 * Thin BullMQ adapter — all real logic lives in
 * `StripeEventProcessorService` so it stays unit-testable without a running
 * queue/worker (mirrors `WhatsAppInboundProcessor`). 5 attempts with
 * exponential backoff (configured at enqueue time in
 * `WebhookIngestionService`); a job that still fails after all attempts is
 * left in BullMQ's failed set for manual inspection rather than silently
 * dropped, since an unprocessed billing event can mean a tenant's
 * subscription state has drifted from Stripe's truth.
 */
@Processor(STRIPE_WEBHOOK_QUEUE)
export class StripeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(private readonly eventProcessor: StripeEventProcessorService) {
    super();
  }

  async process(job: Job<StripeWebhookJobData>): Promise<void> {
    this.logger.log(
      `Processing Stripe webhook log ${job.data.webhookLogId} (attempt ${job.attemptsMade + 1})`,
    );
    await this.eventProcessor.process(job.data.webhookLogId);
  }
}
