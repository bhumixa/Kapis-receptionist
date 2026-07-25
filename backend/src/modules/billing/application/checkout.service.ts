import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantService } from '../../tenants/application/tenant.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { CouponEntity } from '../domain/entities/coupon.entity';
import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
} from '../domain/ports/coupon-repository.port';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepositoryPort,
} from '../domain/ports/subscription-repository.port';
import { EntitlementService } from './entitlement.service';
import {
  callStripe,
  InvalidCouponException,
  PlanNotFoundException,
} from './exceptions/billing.exceptions';
import { PlansService } from './plans.service';
import { StripeClient } from '../infrastructure/stripe-client';

/**
 * `POST /subscriptions` (API_SPECIFICATION.md Section 13) — creates a
 * Stripe Checkout Session so the tenant can attach a payment method and
 * convert their trial to a paid subscription. Lazily creates the Stripe
 * Customer on first use (see the `Subscription` schema doc comment for
 * why this isn't done eagerly at registration) — the only place in this
 * module a Stripe Customer object is ever created.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepositoryPort,
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort,
    private readonly plansService: PlansService,
    private readonly entitlements: EntitlementService,
    private readonly tenants: TenantService,
    private readonly stripeClient: StripeClient,
    private readonly configService: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createCheckoutSession(
    tenantId: string,
    planId: string,
    actor: AccessTokenPayload,
    couponCode?: string,
  ): Promise<{ checkoutUrl: string | null; subscriptionId: string }> {
    const plan = await this.plansService.getPlanOrThrow(planId);
    if (!plan.isActive) {
      throw new PlanNotFoundException();
    }

    const { subscription } =
      await this.entitlements.getOrCreateForTenant(tenantId);

    let stripeCustomerId = subscription.stripeCustomerId;
    if (!stripeCustomerId) {
      const tenant = await this.tenants.getProfile(tenantId);
      stripeCustomerId = await callStripe(() =>
        this.stripeClient.createCustomer(actor.email, tenant.name),
      );
      await this.subscriptions.updateByTenantId(tenantId, {
        stripeCustomerId,
      });
    }

    let stripeCouponId: string | null = null;
    if (couponCode) {
      const coupon = await this.resolveCoupon(couponCode);
      stripeCouponId = coupon.stripeCouponId;
      // Incremented optimistically at session-creation time, not on
      // confirmed payment — a documented simplification (an abandoned
      // Checkout session over-counts by one) rather than parsing Stripe's
      // discount data back out of `checkout.session.completed`.
      await this.coupons.incrementRedemptionCount(coupon.id);
    }

    const session = await callStripe(() =>
      this.stripeClient.createCheckoutSession({
        stripeCustomerId,
        stripePriceId: plan.stripePriceId,
        successUrl: this.configService.getOrThrow<string>(
          'billing.checkoutSuccessUrl',
        ),
        cancelUrl: this.configService.getOrThrow<string>(
          'billing.checkoutCancelUrl',
        ),
        stripeCouponId,
        tenantId,
      }),
    );

    await this.auditLog.record({
      action: 'CHECKOUT_SESSION_CREATED',
      entityType: 'Subscription',
      entityId: subscription.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { planId, couponCode: couponCode ?? null },
    });

    return { checkoutUrl: session.url, subscriptionId: subscription.id };
  }

  private async resolveCoupon(code: string): Promise<CouponEntity> {
    const coupon = await this.coupons.findByCode(code);
    if (!coupon || !coupon.isActive) {
      throw new InvalidCouponException('coupon not found or inactive');
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new InvalidCouponException('coupon has expired');
    }
    if (
      coupon.maxRedemptions !== null &&
      coupon.redemptionCount >= coupon.maxRedemptions
    ) {
      throw new InvalidCouponException('coupon redemption limit reached');
    }
    return coupon;
  }
}
