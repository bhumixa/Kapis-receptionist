import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InboundMessageProcessorService } from '../application/inbound-message-processor.service';
import {
  InboundWebhookJobData,
  WHATSAPP_INBOUND_QUEUE,
} from './whatsapp-queue.constants';

/**
 * Thin BullMQ adapter — all real logic lives in
 * `InboundMessageProcessorService` so it stays unit-testable without a
 * running queue/worker. 5 attempts with exponential backoff (configured at
 * enqueue time in `WebhookIngestionService`); a job that still fails after
 * all attempts is left in BullMQ's failed set for manual inspection rather
 * than silently dropped, since an unprocessed inbound message is a real
 * customer message that never reached a conversation.
 */
@Processor(WHATSAPP_INBOUND_QUEUE)
export class WhatsAppInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppInboundProcessor.name);

  constructor(
    private readonly inboundProcessor: InboundMessageProcessorService,
  ) {
    super();
  }

  async process(job: Job<InboundWebhookJobData>): Promise<void> {
    this.logger.log(
      `Processing inbound webhook event ${job.data.webhookEventId} (attempt ${job.attemptsMade + 1})`,
    );
    await this.inboundProcessor.process(job.data.webhookEventId);
  }
}
