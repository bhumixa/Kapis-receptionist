import {
  InvoiceStatus,
  PaymentStatus,
  WebhookProcessingStatus,
} from '@prisma/client';
import { StripeEventProcessorService } from '../../../src/modules/billing/application/stripe-event-processor.service';
import { SubscriptionsService } from '../../../src/modules/billing/application/subscriptions.service';
import { UsageTrackingService } from '../../../src/modules/billing/application/usage-tracking.service';
import { InvoiceRepositoryPort } from '../../../src/modules/billing/domain/ports/invoice-repository.port';
import { PaymentRepositoryPort } from '../../../src/modules/billing/domain/ports/payment-repository.port';
import { SubscriptionRepositoryPort } from '../../../src/modules/billing/domain/ports/subscription-repository.port';
import { WebhookLogRepositoryPort } from '../../../src/modules/billing/domain/ports/webhook-log-repository.port';
import { WebhookLogEntity } from '../../../src/modules/billing/domain/entities/webhook-log.entity';
import { SubscriptionEntity } from '../../../src/modules/billing/domain/entities/subscription.entity';

function makeWebhookLog(
  payload: unknown,
  overrides: Partial<WebhookLogEntity> = {},
): WebhookLogEntity {
  return {
    id: 'log-1',
    provider: 'STRIPE',
    providerEventId: 'evt_1',
    eventType: 'customer.subscription.updated',
    payload,
    tenantId: null,
    processingStatus: WebhookProcessingStatus.PENDING,
    processedAt: null,
    errorMessage: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<SubscriptionEntity> = {},
): SubscriptionEntity {
  return {
    id: 'sub-1',
    tenantId: 'tenant-1',
    planId: 'plan-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_stripe_1',
    status: 'ACTIVE',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    couponId: null,
    messagesUsedCurrentPeriod: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedByType: 'SYSTEM',
    updatedById: null,
    ...overrides,
  };
}

describe('StripeEventProcessorService', () => {
  let webhookLogs: jest.Mocked<WebhookLogRepositoryPort>;
  let subscriptions: jest.Mocked<SubscriptionRepositoryPort>;
  let invoices: jest.Mocked<InvoiceRepositoryPort>;
  let payments: jest.Mocked<PaymentRepositoryPort>;
  let subscriptionsService: jest.Mocked<
    Pick<SubscriptionsService, 'applyStripeSubscriptionEvent'>
  >;
  let usageTracking: jest.Mocked<
    Pick<UsageTrackingService, 'resetPeriodUsage'>
  >;
  let service: StripeEventProcessorService;

  beforeEach(() => {
    webhookLogs = {
      create: jest.fn(),
      findByProviderEventId: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    subscriptions = {
      findByTenantId: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      findByStripeSubscriptionId: jest.fn(),
      create: jest.fn(),
      upsertTrialForTenant: jest.fn(),
      updateByTenantId: jest.fn(),
      incrementMessagesUsed: jest.fn(),
      resetMessagesUsed: jest.fn(),
    };
    invoices = {
      findByStripeInvoiceId: jest.fn(),
      upsertByStripeInvoiceId: jest.fn(),
      findForTenant: jest.fn(),
    };
    payments = {
      upsertByStripePaymentIntentId: jest.fn(),
      findForTenant: jest.fn(),
    };
    subscriptionsService = { applyStripeSubscriptionEvent: jest.fn() };
    usageTracking = { resetPeriodUsage: jest.fn() };

    service = new StripeEventProcessorService(
      webhookLogs,
      subscriptions,
      invoices,
      payments,
      subscriptionsService as unknown as SubscriptionsService,
      usageTracking as unknown as UsageTrackingService,
    );
  });

  it('does nothing when the webhook log cannot be found', async () => {
    webhookLogs.findById.mockResolvedValue(null);

    await service.process('missing-log');

    expect(webhookLogs.updateStatus).not.toHaveBeenCalled();
  });

  it('dispatches a subscription event, applies it, and marks the log PROCESSED with the resolved tenant', async () => {
    webhookLogs.findById.mockResolvedValue(
      makeWebhookLog({
        id: 'evt_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_stripe_1',
            customer: 'cus_123',
            status: 'active',
            cancel_at_period_end: false,
            canceled_at: null,
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      }),
    );
    subscriptions.findByStripeCustomerId.mockResolvedValue(
      makeSubscription({ tenantId: 'tenant-1' }),
    );

    await service.process('log-1');

    expect(
      subscriptionsService.applyStripeSubscriptionEvent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_stripe_1',
        stripeCustomerId: 'cus_123',
        stripeStatus: 'active',
        stripePriceId: 'price_pro',
      }),
    );
    expect(webhookLogs.updateStatus).toHaveBeenCalledWith(
      'log-1',
      WebhookProcessingStatus.PROCESSED,
      { tenantId: 'tenant-1' },
    );
  });

  it('resets period usage on a paid invoice', async () => {
    webhookLogs.findById.mockResolvedValue(
      makeWebhookLog(
        {
          id: 'evt_2',
          type: 'invoice.paid',
          data: {
            object: {
              id: 'in_1',
              customer: 'cus_123',
              status: 'paid',
              amount_due: 4900,
              amount_paid: 4900,
              currency: 'usd',
              created: 1700000000,
              due_date: null,
              invoice_pdf: 'https://stripe.test/invoice.pdf',
            },
          },
        },
        { eventType: 'invoice.paid' },
      ),
    );
    subscriptions.findByStripeCustomerId.mockResolvedValue(
      makeSubscription({ tenantId: 'tenant-1' }),
    );

    await service.process('log-1');

    expect(invoices.upsertByStripeInvoiceId).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        stripeInvoiceId: 'in_1',
        status: InvoiceStatus.PAID,
      }),
    );
    expect(usageTracking.resetPeriodUsage).toHaveBeenCalledWith('tenant-1');
  });

  it('records a failed payment intent', async () => {
    webhookLogs.findById.mockResolvedValue(
      makeWebhookLog(
        {
          id: 'evt_3',
          type: 'payment_intent.payment_failed',
          data: {
            object: {
              id: 'pi_1',
              customer: 'cus_123',
              amount: 4900,
              currency: 'usd',
              last_payment_error: {
                code: 'card_declined',
                message: 'Declined',
              },
            },
          },
        },
        { eventType: 'payment_intent.payment_failed' },
      ),
    );
    subscriptions.findByStripeCustomerId.mockResolvedValue(
      makeSubscription({ tenantId: 'tenant-1' }),
    );

    await service.process('log-1');

    expect(payments.upsertByStripePaymentIntentId).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.FAILED,
        failureCode: 'card_declined',
      }),
    );
  });

  it('ignores unhandled event types without error', async () => {
    webhookLogs.findById.mockResolvedValue(
      makeWebhookLog(
        { id: 'evt_4', type: 'charge.dispute.created', data: { object: {} } },
        { eventType: 'charge.dispute.created' },
      ),
    );

    await service.process('log-1');

    expect(webhookLogs.updateStatus).toHaveBeenCalledWith(
      'log-1',
      WebhookProcessingStatus.PROCESSED,
      undefined,
    );
  });

  it('marks the log FAILED and rethrows when processing throws', async () => {
    webhookLogs.findById.mockResolvedValue(
      makeWebhookLog(
        {
          id: 'evt_5',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_x',
              customer: 'cus_x',
              status: 'active',
              items: { data: [] },
            },
          },
        },
        { eventType: 'customer.subscription.updated' },
      ),
    );
    subscriptions.findByStripeCustomerId.mockResolvedValue(null);
    subscriptionsService.applyStripeSubscriptionEvent.mockRejectedValue(
      new Error('boom'),
    );

    await expect(service.process('log-1')).rejects.toThrow('boom');

    expect(webhookLogs.updateStatus).toHaveBeenCalledWith(
      'log-1',
      WebhookProcessingStatus.FAILED,
      { errorMessage: 'boom' },
    );
  });
});
