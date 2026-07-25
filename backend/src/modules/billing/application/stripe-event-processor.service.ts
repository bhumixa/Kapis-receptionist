import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  WebhookProcessingStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepositoryPort,
} from '../domain/ports/invoice-repository.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../domain/ports/payment-repository.port';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepositoryPort,
} from '../domain/ports/subscription-repository.port';
import {
  WEBHOOK_LOG_REPOSITORY,
  type WebhookLogRepositoryPort,
} from '../domain/ports/webhook-log-repository.port';
import { SubscriptionsService } from './subscriptions.service';
import { UsageTrackingService } from './usage-tracking.service';

/** Stripe's own invoice-status strings, mapped onto this platform's `InvoiceStatus` enum. */
const STRIPE_INVOICE_STATUS_MAP: Record<string, InvoiceStatus> = {
  draft: InvoiceStatus.DRAFT,
  open: InvoiceStatus.OPEN,
  paid: InvoiceStatus.PAID,
  void: InvoiceStatus.VOID,
  uncollectible: InvoiceStatus.UNCOLLECTIBLE,
};

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function customerIdOf(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

/**
 * The business logic behind `stripe-webhook` BullMQ jobs
 * (`queues/stripe-webhook.processor.ts` is the thin BullMQ adapter that
 * calls this) — mirrors `InboundMessageProcessorService`'s role in
 * WhatsApp. Dispatches on `event.type`; every branch is independently
 * idempotent (upsert-by-Stripe-id or a `findByStripeCustomerId` resolve),
 * so BullMQ's at-least-once redelivery on a transient failure is always
 * safe to replay.
 */
@Injectable()
export class StripeEventProcessorService {
  private readonly logger = new Logger(StripeEventProcessorService.name);

  constructor(
    @Inject(WEBHOOK_LOG_REPOSITORY)
    private readonly webhookLogs: WebhookLogRepositoryPort,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepositoryPort,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: InvoiceRepositoryPort,
    @Inject(PAYMENT_REPOSITORY)
    private readonly payments: PaymentRepositoryPort,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usageTracking: UsageTrackingService,
  ) {}

  async process(webhookLogId: string): Promise<void> {
    const webhookLog = await this.webhookLogs.findById(webhookLogId);
    if (!webhookLog) {
      this.logger.warn(`WebhookLog ${webhookLogId} not found — skipping`);
      return;
    }

    try {
      const event = webhookLog.payload as Stripe.Event;
      const tenantId = await this.dispatch(event);

      await this.webhookLogs.updateStatus(
        webhookLogId,
        WebhookProcessingStatus.PROCESSED,
        tenantId ? { tenantId } : undefined,
      );
    } catch (error) {
      await this.webhookLogs.updateStatus(
        webhookLogId,
        WebhookProcessingStatus.FAILED,
        { errorMessage: (error as Error).message },
      );
      throw error;
    }
  }

  /** Returns the resolved tenantId (if any) for the WebhookLog row's own bookkeeping. */
  private async dispatch(event: Stripe.Event): Promise<string | null> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.handleSubscriptionEvent(event);
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.finalized':
      case 'invoice.payment_failed':
        return this.handleInvoiceEvent(event);
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        return this.handlePaymentIntentEvent(event);
      default:
        this.logger.log(`Ignoring unhandled Stripe event type ${event.type}`);
        return null;
    }
  }

  private async handleSubscriptionEvent(
    event: Stripe.Event,
  ): Promise<string | null> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = customerIdOf(subscription.customer);
    if (!customerId) return null;

    const priceId = subscription.items.data[0]?.price?.id ?? null;

    await this.subscriptionsService.applyStripeSubscriptionEvent({
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      stripeStatus: subscription.status,
      stripePriceId: priceId,
      currentPeriodStart: toDate(
        (subscription as unknown as { current_period_start?: number })
          .current_period_start,
      ),
      currentPeriodEnd: toDate(
        (subscription as unknown as { current_period_end?: number })
          .current_period_end,
      ),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
    });

    const local = await this.subscriptions.findByStripeCustomerId(customerId);
    return local?.tenantId ?? null;
  }

  private async handleInvoiceEvent(
    event: Stripe.Event,
  ): Promise<string | null> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = customerIdOf(invoice.customer);
    if (!customerId) return null;

    const local = await this.subscriptions.findByStripeCustomerId(customerId);
    if (!local) {
      this.logger.warn(
        `No local Subscription for Stripe customer ${customerId} — dropping invoice event`,
      );
      return null;
    }

    const status =
      STRIPE_INVOICE_STATUS_MAP[invoice.status ?? ''] ?? InvoiceStatus.OPEN;

    await this.invoices.upsertByStripeInvoiceId({
      tenantId: local.tenantId,
      subscriptionId: local.id,
      stripeInvoiceId: invoice.id ?? `unknown-${event.id}`,
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      status,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      issuedAt: toDate(invoice.created) ?? new Date(),
      dueAt: toDate(invoice.due_date),
      paidAt: status === InvoiceStatus.PAID ? new Date() : null,
    });

    // A newly paid invoice marks the start of a fresh billing period —
    // reset the AI/WhatsApp message counter (docs/FEATURE_ENTITLEMENTS.md).
    if (event.type === 'invoice.paid' && status === InvoiceStatus.PAID) {
      await this.usageTracking.resetPeriodUsage(local.tenantId);
    }

    return local.tenantId;
  }

  private async handlePaymentIntentEvent(
    event: Stripe.Event,
  ): Promise<string | null> {
    const intent = event.data.object as Stripe.PaymentIntent;
    const customerId = customerIdOf(intent.customer);
    if (!customerId) return null;

    const local = await this.subscriptions.findByStripeCustomerId(customerId);
    if (!local) {
      this.logger.warn(
        `No local Subscription for Stripe customer ${customerId} — dropping payment event`,
      );
      return null;
    }

    await this.payments.upsertByStripePaymentIntentId({
      tenantId: local.tenantId,
      invoiceId: null,
      stripePaymentIntentId: intent.id,
      amountCents: intent.amount,
      currency: intent.currency.toUpperCase(),
      status:
        event.type === 'payment_intent.succeeded'
          ? PaymentStatus.SUCCEEDED
          : PaymentStatus.FAILED,
      failureCode: intent.last_payment_error?.code ?? null,
      failureMessage: intent.last_payment_error?.message ?? null,
      attemptedAt: new Date(),
    });

    return local.tenantId;
  }
}
