import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { STRIPE_WEBHOOK_QUEUE } from './billing-queue.constants';

/**
 * Registers the `stripe-webhook` BullMQ queue against the shared root
 * connection (`queues/bullmq-root.module.ts`) — reusing WhatsApp's existing
 * connection rather than opening a second one (ADR-010's own Consequences
 * note, anticipating this exact milestone). Deliberately does not declare
 * `StripeWebhookProcessor` here — same reasoning as `WhatsAppQueueModule`:
 * it depends on this module's own application-layer services and would
 * create a circular module dependency if registered here instead of in
 * `billing.module.ts`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: STRIPE_WEBHOOK_QUEUE })],
  exports: [BullModule],
})
export class BillingQueueModule {}
