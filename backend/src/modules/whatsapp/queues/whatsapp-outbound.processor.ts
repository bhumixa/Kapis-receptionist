import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OutboundMessageService } from '../application/outbound-message.service';
import {
  OutboundMessageJobData,
  WHATSAPP_OUTBOUND_QUEUE,
} from './whatsapp-queue.constants';

/**
 * Thin BullMQ adapter over `OutboundMessageService` (kept unit-testable
 * without a running queue/worker). `onFailed` fires once BullMQ has
 * exhausted every configured retry attempt for a transient failure —
 * that's the point the message is finally marked `FAILED` for staff
 * visibility, rather than leaving it stuck `QUEUED` forever.
 */
@Processor(WHATSAPP_OUTBOUND_QUEUE)
export class WhatsAppOutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppOutboundProcessor.name);

  constructor(private readonly outboundMessageService: OutboundMessageService) {
    super();
  }

  async process(job: Job<OutboundMessageJobData>): Promise<void> {
    this.logger.log(
      `Sending message ${job.data.messageId} (attempt ${job.attemptsMade + 1})`,
    );
    await this.outboundMessageService.send(
      job.data.tenantId,
      job.data.messageId,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<OutboundMessageJobData> | undefined): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
      return;
    }
    this.logger.warn(
      `Message ${job.data.messageId} permanently failed after ${job.attemptsMade} attempts`,
    );
    await this.outboundMessageService.markPermanentlyFailed(
      job.data.tenantId,
      job.data.messageId,
      job.failedReason ?? 'Retries exhausted',
    );
  }
}
