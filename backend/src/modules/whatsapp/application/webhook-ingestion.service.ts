import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepositoryPort,
} from '../domain/ports/webhook-event-repository.port';
import {
  InvalidVerifyTokenException,
  InvalidWebhookSignatureException,
} from './exceptions/whatsapp.exceptions';
import { verifyWhatsAppSignature } from '../infrastructure/whatsapp-signature.util';
import {
  type InboundWebhookJobData,
  WHATSAPP_INBOUND_QUEUE,
} from '../queues/whatsapp-queue.constants';

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{ id?: string }>;
        statuses?: Array<{ id?: string }>;
      };
    }>;
  }>;
}

/**
 * `GET/POST /webhooks/whatsapp` (API_SPECIFICATION.md Section 11,
 * SYSTEM_ARCHITECTURE.md Section 6.1/6.9). The controller's only
 * synchronous work is signature verification + persisting the raw event —
 * everything else (tenant resolution, contact sync, conversation/message
 * writes) happens in `InboundMessageProcessorService`, off the BullMQ
 * `whatsapp-inbound` queue, so Meta always gets a fast `200 OK` regardless
 * of downstream processing time (Meta retries on timeout/non-2xx).
 */
@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly webhookEvents: WebhookEventRepositoryPort,
    @InjectQueue(WHATSAPP_INBOUND_QUEUE)
    private readonly inboundQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  /** Meta's one-time verification handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`). */
  handleVerification(mode: string, token: string, challenge: string): string {
    const expectedToken = this.configService.getOrThrow<string>(
      'whatsapp.verifyToken',
    );
    if (mode !== 'subscribe' || token !== expectedToken) {
      throw new InvalidVerifyTokenException();
    }
    return challenge;
  }

  /**
   * Verifies the signature, persists the raw payload regardless of the
   * result (a failed-verification row is forensic evidence of a spoofing
   * attempt, not noise to discard), and only enqueues for processing when
   * the signature is genuinely valid.
   */
  async ingest(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<void> {
    const appSecret =
      this.configService.getOrThrow<string>('whatsapp.appSecret');
    const signatureValid = verifyWhatsAppSignature(
      appSecret,
      rawBody,
      signatureHeader,
    );

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WhatsAppWebhookPayload;
    } catch {
      payload = {};
    }

    const value = payload.entry?.[0]?.changes?.[0]?.value;
    const whatsappMessageId =
      value?.messages?.[0]?.id ?? value?.statuses?.[0]?.id ?? null;
    const eventType = value?.messages
      ? 'messages'
      : value?.statuses
        ? 'statuses'
        : (payload.object ?? 'unknown');

    const webhookEvent = await this.webhookEvents.create({
      tenantId: null,
      whatsappMessageId,
      eventType,
      payload,
      signatureValid,
    });

    if (!signatureValid) {
      this.logger.warn(
        `Rejected WhatsApp webhook with invalid signature (event ${webhookEvent.id})`,
      );
      throw new InvalidWebhookSignatureException();
    }

    const jobData: InboundWebhookJobData = { webhookEventId: webhookEvent.id };
    await this.inboundQueue.add('process-webhook-event', jobData, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
