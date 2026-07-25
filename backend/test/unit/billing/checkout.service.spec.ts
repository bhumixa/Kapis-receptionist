import { ConfigService } from '@nestjs/config';
import { RoleName, SubscriptionStatus } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { CheckoutService } from '../../../src/modules/billing/application/checkout.service';
import { EntitlementService } from '../../../src/modules/billing/application/entitlement.service';
import { InvalidCouponException } from '../../../src/modules/billing/application/exceptions/billing.exceptions';
import { PlansService } from '../../../src/modules/billing/application/plans.service';
import { CouponEntity } from '../../../src/modules/billing/domain/entities/coupon.entity';
import { CouponRepositoryPort } from '../../../src/modules/billing/domain/ports/coupon-repository.port';
import { SubscriptionEntity } from '../../../src/modules/billing/domain/entities/subscription.entity';
import { SubscriptionRepositoryPort } from '../../../src/modules/billing/domain/ports/subscription-repository.port';
import { PlanEntity } from '../../../src/modules/billing/domain/entities/plan.entity';
import { StripeClient } from '../../../src/modules/billing/infrastructure/stripe-client';
import { TenantService } from '../../../src/modules/tenants/application/tenant.service';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makePlan(overrides: Partial<PlanEntity> = {}): PlanEntity {
  return {
    id: 'plan-1',
    name: 'Starter',
    stripePriceId: 'price_starter',
    monthlyPriceCents: 4900,
    currency: 'USD',
    maxStaff: 5,
    maxMessagesPerMonth: 1000,
    maxLocations: 1,
    maxAppointmentsPerMonth: 500,
    maxStorageMb: 1024,
    isActive: true,
    trialDays: 14,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: SubscriptionStatus.TRIALING,
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

function makeCoupon(overrides: Partial<CouponEntity> = {}): CouponEntity {
  return {
    id: 'coupon-1',
    code: 'WELCOME10',
    stripeCouponId: 'stripe_coupon_1',
    discountType: 'PERCENT',
    discountValue: 10,
    durationType: 'ONCE',
    durationInMonths: null,
    maxRedemptions: 100,
    redemptionCount: 0,
    expiresAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConfigService(): ConfigService {
  const values: Record<string, string> = {
    'billing.checkoutSuccessUrl': 'http://localhost/success',
    'billing.checkoutCancelUrl': 'http://localhost/cancel',
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('CheckoutService', () => {
  let subscriptions: jest.Mocked<SubscriptionRepositoryPort>;
  let coupons: jest.Mocked<CouponRepositoryPort>;
  let plansService: jest.Mocked<Pick<PlansService, 'getPlanOrThrow'>>;
  let entitlements: jest.Mocked<
    Pick<EntitlementService, 'getOrCreateForTenant'>
  >;
  let tenants: jest.Mocked<Pick<TenantService, 'getProfile'>>;
  let stripeClient: jest.Mocked<
    Pick<StripeClient, 'createCustomer' | 'createCheckoutSession'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: CheckoutService;

  beforeEach(() => {
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
    coupons = {
      findByCode: jest.fn(),
      findById: jest.fn(),
      incrementRedemptionCount: jest.fn(),
    };
    plansService = { getPlanOrThrow: jest.fn().mockResolvedValue(makePlan()) };
    entitlements = {
      getOrCreateForTenant: jest.fn().mockResolvedValue({
        subscription: makeSubscription(),
        plan: makePlan(),
      }),
    };
    tenants = {
      getProfile: jest
        .fn()
        .mockResolvedValue({ id: 'tenant-1', name: 'Bella Salon' }),
    };
    stripeClient = {
      createCustomer: jest.fn().mockResolvedValue('cus_new'),
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/checkout' }),
    };
    auditLog = { record: jest.fn() };

    service = new CheckoutService(
      subscriptions,
      coupons,
      plansService as unknown as PlansService,
      entitlements as unknown as EntitlementService,
      tenants as unknown as TenantService,
      stripeClient as unknown as StripeClient,
      makeConfigService(),
      auditLog as unknown as AuditLogService,
    );
  });

  it('lazily creates a Stripe customer when the subscription has none yet', async () => {
    await service.createCheckoutSession('tenant-1', 'plan-1', actor);

    expect(stripeClient.createCustomer).toHaveBeenCalledWith(
      actor.email,
      'Bella Salon',
    );
    expect(subscriptions.updateByTenantId).toHaveBeenCalledWith('tenant-1', {
      stripeCustomerId: 'cus_new',
    });
  });

  it('reuses the existing Stripe customer id without creating a new one', async () => {
    entitlements.getOrCreateForTenant.mockResolvedValue({
      subscription: makeSubscription({ stripeCustomerId: 'cus_existing' }),
      plan: makePlan(),
    });

    await service.createCheckoutSession('tenant-1', 'plan-1', actor);

    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_existing' }),
    );
  });

  it('rejects an unknown or inactive coupon code', async () => {
    coupons.findByCode.mockResolvedValue(null);

    await expect(
      service.createCheckoutSession('tenant-1', 'plan-1', actor, 'BADCODE'),
    ).rejects.toThrow(InvalidCouponException);
  });

  it('rejects an exhausted coupon', async () => {
    coupons.findByCode.mockResolvedValue(
      makeCoupon({ maxRedemptions: 5, redemptionCount: 5 }),
    );

    await expect(
      service.createCheckoutSession('tenant-1', 'plan-1', actor, 'WELCOME10'),
    ).rejects.toThrow(InvalidCouponException);
  });

  it('applies a valid coupon and increments its redemption count', async () => {
    coupons.findByCode.mockResolvedValue(makeCoupon());

    await service.createCheckoutSession(
      'tenant-1',
      'plan-1',
      actor,
      'WELCOME10',
    );

    expect(coupons.incrementRedemptionCount).toHaveBeenCalledWith('coupon-1');
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCouponId: 'stripe_coupon_1' }),
    );
  });
});
