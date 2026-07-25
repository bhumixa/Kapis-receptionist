import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * `statusCode`/`isTransient` mirrors `WhatsAppCloudApiError`'s
 * retry-classification precedent (`whatsapp/infrastructure/
 * whatsapp-cloud-api.client.ts`) — a connection/rate-limit failure is worth
 * a BullMQ retry (webhook processing), a validation/auth failure is not.
 */
export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly stripeType: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'StripeApiError';
  }

  get isTransient(): boolean {
    return (
      this.stripeType === 'StripeConnectionError' ||
      this.stripeType === 'StripeAPIError' ||
      this.stripeType === 'StripeRateLimitError'
    );
  }
}

export interface CreateCheckoutSessionParams {
  stripeCustomerId: string;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  stripeCouponId?: string | null;
  tenantId: string;
}

export interface CreatePortalSessionParams {
  stripeCustomerId: string;
  returnUrl: string;
}

/**
 * The only file in this module that imports the `stripe` package (same
 * "one adapter, one import" convention as `OpenAiLlmProvider`/
 * `WhatsAppCloudApiClient`). Every method here is a thin, single-purpose
 * wrapper — `EntitlementService`/read paths never call this class at all,
 * only `CheckoutService`/`CustomerPortalService`/`SubscriptionsService`
 * (plan changes)/`WebhookIngestionService` (signature verification) do, so
 * unit tests for everything else need no Stripe mock whatsoever.
 */
@Injectable()
export class StripeClient implements OnModuleInit {
  private readonly logger = new Logger(StripeClient.name);
  private client!: Stripe;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.client = new Stripe(
      this.configService.getOrThrow<string>('billing.stripeSecretKey'),
      { apiVersion: '2026-06-24.dahlia' },
    );
  }

  async createCustomer(email: string, name: string): Promise<string> {
    const customer = await this.wrap(() =>
      this.client.customers.create({ email, name }),
    );
    return customer.id;
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<{ id: string; url: string | null }> {
    const session = await this.wrap(() =>
      this.client.checkout.sessions.create({
        mode: 'subscription',
        customer: params.stripeCustomerId,
        line_items: [{ price: params.stripePriceId, quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        discounts: params.stripeCouponId
          ? [{ coupon: params.stripeCouponId }]
          : undefined,
        subscription_data: { metadata: { tenantId: params.tenantId } },
        metadata: { tenantId: params.tenantId },
      }),
    );
    return { id: session.id, url: session.url };
  }

  async createPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<{ url: string }> {
    const session = await this.wrap(() =>
      this.client.billingPortal.sessions.create({
        customer: params.stripeCustomerId,
        return_url: params.returnUrl,
      }),
    );
    return { url: session.url };
  }

  /** Immediate plan change with Stripe proration (both upgrade and downgrade — one code path). */
  async changeSubscriptionPrice(
    stripeSubscriptionId: string,
    stripePriceId: string,
  ): Promise<void> {
    const subscription = await this.wrap(() =>
      this.client.subscriptions.retrieve(stripeSubscriptionId),
    );
    const itemId = subscription.items.data[0]?.id;
    await this.wrap(() =>
      this.client.subscriptions.update(stripeSubscriptionId, {
        items: itemId
          ? [{ id: itemId, price: stripePriceId }]
          : [{ price: stripePriceId }],
        proration_behavior: 'create_prorations',
      }),
    );
  }

  async cancelAtPeriodEnd(stripeSubscriptionId: string): Promise<void> {
    await this.wrap(() =>
      this.client.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      }),
    );
  }

  async resumeSubscription(stripeSubscriptionId: string): Promise<void> {
    await this.wrap(() =>
      this.client.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: false,
      }),
    );
  }

  /**
   * Uses the SDK's own signature verification (timestamp + tolerance +
   * HMAC against the raw body) rather than a hand-rolled implementation —
   * unlike WhatsApp/Meta, Stripe ships this natively.
   */
  constructWebhookEvent(
    rawBody: Buffer,
    signatureHeader: string,
  ): Stripe.Event {
    const webhookSecret = this.configService.getOrThrow<string>(
      'billing.stripeWebhookSecret',
    );
    return this.client.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      webhookSecret,
    );
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const stripeType =
        error instanceof Stripe.errors.StripeError ? error.type : 'Unknown';
      const message =
        error instanceof Error ? error.message : 'Unknown Stripe error';
      this.logger.warn(`Stripe API call failed (${stripeType}): ${message}`);
      throw new StripeApiError(message, stripeType, error);
    }
  }
}
