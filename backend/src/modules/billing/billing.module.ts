import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../../core/idempotency/idempotency.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingQueueModule } from './queues/billing-queue.module';
import { StripeWebhookProcessor } from './queues/stripe-webhook.processor';
import { COUPON_REPOSITORY } from './domain/ports/coupon-repository.port';
import { INVOICE_REPOSITORY } from './domain/ports/invoice-repository.port';
import { PAYMENT_REPOSITORY } from './domain/ports/payment-repository.port';
import { PLAN_REPOSITORY } from './domain/ports/plan-repository.port';
import { SUBSCRIPTION_REPOSITORY } from './domain/ports/subscription-repository.port';
import { WEBHOOK_LOG_REPOSITORY } from './domain/ports/webhook-log-repository.port';
import { PrismaCouponRepository } from './infrastructure/prisma-coupon.repository';
import { PrismaInvoiceRepository } from './infrastructure/prisma-invoice.repository';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { PrismaPlanRepository } from './infrastructure/prisma-plan.repository';
import { PrismaSubscriptionRepository } from './infrastructure/prisma-subscription.repository';
import { PrismaWebhookLogRepository } from './infrastructure/prisma-webhook-log.repository';
import { StripeClient } from './infrastructure/stripe-client';
import { CheckoutService } from './application/checkout.service';
import { CustomerPortalService } from './application/customer-portal.service';
import { EntitlementService } from './application/entitlement.service';
import { InvoicesService } from './application/invoices.service';
import { PlansService } from './application/plans.service';
import { StripeEventProcessorService } from './application/stripe-event-processor.service';
import { SubscriptionsService } from './application/subscriptions.service';
import { UsageTrackingService } from './application/usage-tracking.service';
import { WebhookIngestionService } from './application/webhook-ingestion.service';
import {
  InvoicesController,
  PaymentsController,
} from './interface/invoices.controller';
import { PlansController } from './interface/plans.controller';
import { SubscriptionsController } from './interface/subscriptions.controller';
import { WebhooksController } from './interface/webhooks.controller';

/**
 * Milestone 9's Billing & Subscription Management (docs/BILLING_
 * ARCHITECTURE.md, docs/STRIPE_INTEGRATION.md, docs/FEATURE_ENTITLEMENTS.md,
 * docs/adr/ADR-012-billing-and-subscriptions.md). A single module housing
 * `Plan`/`Subscription`/`Invoice`/`Payment`/`Coupon`/`WebhookLog` — the same
 * "one module, layered per aggregate" precedent WhatsApp and AI already
 * established, not five separate NestJS modules.
 *
 * `EntitlementService`/`UsageTrackingService` are exported for every other
 * module's write paths to call (Employees, Appointments, WhatsApp/AI) — this
 * is a one-directional dependency (those modules import `BillingModule`,
 * not the other way around), since `EntitlementService` only ever reads its
 * own module's `Subscription`/`Plan` data and takes counts as plain
 * parameters rather than reaching into another module's repository (see
 * that service's own doc comment) — no `forwardRef` needed for entitlement
 * checks, unlike the genuine `AiModule`<->`WhatsAppModule` cycle.
 *
 * `TenantsModule` is imported for `TenantLifecycleService.syncStatusFromBilling`
 * (`SubscriptionsService`) and `TenantService.getProfile` (`CheckoutService`).
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    IdempotencyModule,
    TenantsModule,
    BillingQueueModule,
  ],
  controllers: [
    PlansController,
    SubscriptionsController,
    InvoicesController,
    PaymentsController,
    WebhooksController,
  ],
  providers: [
    { provide: PLAN_REPOSITORY, useClass: PrismaPlanRepository },
    {
      provide: SUBSCRIPTION_REPOSITORY,
      useClass: PrismaSubscriptionRepository,
    },
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: COUPON_REPOSITORY, useClass: PrismaCouponRepository },
    { provide: WEBHOOK_LOG_REPOSITORY, useClass: PrismaWebhookLogRepository },
    StripeClient,
    PlansService,
    EntitlementService,
    SubscriptionsService,
    CheckoutService,
    CustomerPortalService,
    InvoicesService,
    UsageTrackingService,
    WebhookIngestionService,
    StripeEventProcessorService,
    StripeWebhookProcessor,
  ],
  exports: [
    EntitlementService,
    UsageTrackingService,
    PlansService,
    SubscriptionsService,
    InvoicesService,
  ],
})
export class BillingModule {}
