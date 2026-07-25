import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Stripe from 'stripe';
import { RedisService } from '../../../database/redis.service';
import {
  WEBHOOK_LOG_REPOSITORY,
  type WebhookLogRepositoryPort,
} from '../domain/ports/webhook-log-repository.port';
import { InvalidStripeWebhookSignatureException } from './exceptions/billing.exceptions';
import { StripeClient } from '../infrastructure/stripe-client';
import {
  STRIPE_WEBHOOK_QUEUE,
  type StripeWebhookJobData,
} from '../queues/billing-queue.constants';

/** Redis dedup TTL (docs/DATABASE_DESIGN.md Section 10.7) — the DB unique constraint on `(provider, providerEventId)` remains authoritative after this expires. */
const DEDUP_TTL_SECONDS = 60 * 60 * 48;
const PROVIDER = 'STRIPE';

/**
 * `POST /stripe/webhook` (API_SPECIFICATION.md Section 2.12/13) — mirrors
 * WhatsApp's `WebhookIngestionService` exactly: verify, persist the raw
 * event regardless of outcome, enqueue for async processing, return fast.
 * Signature verification uses the Stripe SDK's own `constructEvent`
 * (`StripeClient.constructWebhookEvent`) rather than a hand-rolled HMAC —
 * unlike Meta, Stripe ships this natively.
 */
@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    @Inject(WEBHOOK_LOG_REPOSITORY)
    private readonly webhookLogs: WebhookLogRepositoryPort,
    @InjectQueue(STRIPE_WEBHOOK_QUEUE)
    private readonly stripeWebhookQueue: Queue,
    private readonly stripeClient: StripeClient,
    private readonly redis: RedisService,
  ) {}

  async ingest(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripeClient.constructWebhookEvent(
        rawBody,
        signatureHeader ?? '',
      );
    } catch (error) {
      // Signature verification failed — persist what we can for forensic
      // visibility (a spoofing attempt is evidence, not noise to discard),
      // using a synthetic, always-unique providerEventId since we don't
      // trust the payload enough to extract Stripe's real event id from it.
      await this.webhookLogs.create({
        provider: PROVIDER,
        providerEventId: `invalid-${randomUUID()}`,
        eventType: 'unknown',
        payload: this.safeParse(rawBody),
        tenantId: null,
      });
      this.logger.warn(
        `Rejected Stripe webhook with invalid signature: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InvalidStripeWebhookSignatureException();
    }

    const dedupKey = `dedup:stripe:${event.id}`;
    const acquired = await this.redis.set(
      dedupKey,
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.log(`Duplicate Stripe webhook event ${event.id} — skipped`);
      return;
    }

    const existing = await this.webhookLogs.findByProviderEventId(
      PROVIDER,
      event.id,
    );
    if (existing) {
      this.logger.log(
        `Stripe webhook event ${event.id} already persisted — skipped`,
      );
      return;
    }

    const webhookLog = await this.webhookLogs.create({
      provider: PROVIDER,
      providerEventId: event.id,
      eventType: event.type,
      payload: event,
      tenantId: null,
    });

    const jobData: StripeWebhookJobData = { webhookLogId: webhookLog.id };
    await this.stripeWebhookQueue.add('process-stripe-webhook-event', jobData, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  private safeParse(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      return {};
    }
  }
}
