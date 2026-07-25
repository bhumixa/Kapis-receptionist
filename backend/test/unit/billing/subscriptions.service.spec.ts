import { RoleName, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantLifecycleService } from '../../../src/modules/tenants/application/tenant-lifecycle.service';
import { EntitlementService } from '../../../src/modules/billing/application/entitlement.service';
import {
  NoStripeSubscriptionException,
  SubscriptionAlreadyActiveOnPlanException,
  SubscriptionAlreadyCanceledException,
} from '../../../src/modules/billing/application/exceptions/billing.exceptions';
import { SubscriptionsService } from '../../../src/modules/billing/application/subscriptions.service';
import { PlanEntity } from '../../../src/modules/billing/domain/entities/plan.entity';
import { PlanRepositoryPort } from '../../../src/modules/billing/domain/ports/plan-repository.port';
import { SubscriptionEntity } from '../../../src/modules/billing/domain/entities/subscription.entity';
import { SubscriptionRepositoryPort } from '../../../src/modules/billing/domain/ports/subscription-repository.port';
import { StripeClient } from '../../../src/modules/billing/infrastructure/stripe-client';

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
    stripeCustomerId: 'cus_123',
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

describe('SubscriptionsService', () => {
  let subscriptions: jest.Mocked<SubscriptionRepositoryPort>;
  let plans: jest.Mocked<PlanRepositoryPort>;
  let entitlements: jest.Mocked<
    Pick<EntitlementService, 'getOrCreateForTenant'>
  >;
  let tenantLifecycle: jest.Mocked<
    Pick<TenantLifecycleService, 'syncStatusFromBilling'>
  >;
  let stripeClient: jest.Mocked<
    Pick<
      StripeClient,
      'changeSubscriptionPrice' | 'cancelAtPeriodEnd' | 'resumeSubscription'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: SubscriptionsService;

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
    plans = {
      findActive: jest.fn(),
      findById: jest.fn(),
      findByStripePriceId: jest.fn(),
      findDefault: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
    };
    entitlements = { getOrCreateForTenant: jest.fn() };
    tenantLifecycle = { syncStatusFromBilling: jest.fn() };
    stripeClient = {
      changeSubscriptionPrice: jest.fn().mockResolvedValue(undefined),
      cancelAtPeriodEnd: jest.fn().mockResolvedValue(undefined),
      resumeSubscription: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { record: jest.fn() };

    service = new SubscriptionsService(
      subscriptions,
      plans,
      entitlements as unknown as EntitlementService,
      tenantLifecycle as unknown as TenantLifecycleService,
      stripeClient as unknown as StripeClient,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('changePlan', () => {
    it('throws SubscriptionAlreadyActiveOnPlanException when already on the target plan', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({ planId: 'plan-1' }),
        plan: makePlan(),
      });

      await expect(
        service.changePlan('tenant-1', 'plan-1', actor),
      ).rejects.toThrow(SubscriptionAlreadyActiveOnPlanException);
    });

    it('calls Stripe to change price when a live Stripe subscription exists', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({
          planId: 'plan-1',
          stripeSubscriptionId: 'sub_stripe_1',
        }),
        plan: makePlan(),
      });
      plans.findById.mockResolvedValue(makePlan({ id: 'plan-2' }));
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ planId: 'plan-2' }),
      );

      await service.changePlan('tenant-1', 'plan-2', actor);

      expect(stripeClient.changeSubscriptionPrice).toHaveBeenCalledWith(
        'sub_stripe_1',
        'price_starter',
      );
      expect(subscriptions.updateByTenantId).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ planId: 'plan-2' }),
      );
    });

    it('updates the plan locally without a Stripe call when no live Stripe subscription exists yet', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({
          planId: 'plan-1',
          stripeSubscriptionId: null,
        }),
        plan: makePlan(),
      });
      plans.findById.mockResolvedValue(makePlan({ id: 'plan-2' }));
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ planId: 'plan-2' }),
      );

      await service.changePlan('tenant-1', 'plan-2', actor);

      expect(stripeClient.changeSubscriptionPrice).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('throws SubscriptionAlreadyCanceledException when cancelAtPeriodEnd is already true', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({ cancelAtPeriodEnd: true }),
        plan: makePlan(),
      });

      await expect(service.cancel('tenant-1', actor)).rejects.toThrow(
        SubscriptionAlreadyCanceledException,
      );
    });

    it('schedules a Stripe cancel-at-period-end when a live subscription exists', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({
          stripeSubscriptionId: 'sub_stripe_1',
        }),
        plan: makePlan(),
      });
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ cancelAtPeriodEnd: true }),
      );

      await service.cancel('tenant-1', actor);

      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
      expect(tenantLifecycle.syncStatusFromBilling).not.toHaveBeenCalled();
    });

    it('immediately cancels and syncs tenant status when no live Stripe subscription exists (trial-only)', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({ stripeSubscriptionId: null }),
        plan: makePlan(),
      });
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.CANCELED }),
      );

      await service.cancel('tenant-1', actor);

      expect(stripeClient.cancelAtPeriodEnd).not.toHaveBeenCalled();
      expect(subscriptions.updateByTenantId).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
      );
      expect(tenantLifecycle.syncStatusFromBilling).toHaveBeenCalledWith(
        'tenant-1',
        TenantStatus.CANCELLED,
        {},
        expect.anything(),
      );
    });
  });

  describe('reactivate', () => {
    it('throws NoStripeSubscriptionException when nothing is pending cancellation', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({ cancelAtPeriodEnd: false }),
        plan: makePlan(),
      });

      await expect(service.reactivate('tenant-1', actor)).rejects.toThrow(
        NoStripeSubscriptionException,
      );
    });

    it('resumes the Stripe subscription and clears cancelAtPeriodEnd', async () => {
      entitlements.getOrCreateForTenant.mockResolvedValue({
        subscription: makeSubscription({
          cancelAtPeriodEnd: true,
          stripeSubscriptionId: 'sub_stripe_1',
        }),
        plan: makePlan(),
      });
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ cancelAtPeriodEnd: false }),
      );

      await service.reactivate('tenant-1', actor);

      expect(stripeClient.resumeSubscription).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
    });
  });

  describe('applyStripeSubscriptionEvent', () => {
    it('drops the event when no local subscription matches the Stripe customer id', async () => {
      subscriptions.findByStripeCustomerId.mockResolvedValue(null);

      await service.applyStripeSubscriptionEvent({
        stripeSubscriptionId: 'sub_stripe_1',
        stripeCustomerId: 'cus_unknown',
        stripeStatus: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });

      expect(subscriptions.updateByTenantId).not.toHaveBeenCalled();
    });

    it('maps Stripe status to local status and syncs tenant status', async () => {
      subscriptions.findByStripeCustomerId.mockResolvedValue(
        makeSubscription({ tenantId: 'tenant-1' }),
      );
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.PAST_DUE }),
      );

      await service.applyStripeSubscriptionEvent({
        stripeSubscriptionId: 'sub_stripe_1',
        stripeCustomerId: 'cus_123',
        stripeStatus: 'past_due',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });

      expect(subscriptions.updateByTenantId).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
      );
      expect(tenantLifecycle.syncStatusFromBilling).toHaveBeenCalledWith(
        'tenant-1',
        TenantStatus.PAST_DUE,
        {},
        expect.anything(),
      );
    });

    it('maps an unpaid Stripe status to a SUSPENDED tenant (dunning exhausted)', async () => {
      subscriptions.findByStripeCustomerId.mockResolvedValue(
        makeSubscription({ tenantId: 'tenant-1' }),
      );
      subscriptions.updateByTenantId.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.UNPAID }),
      );

      await service.applyStripeSubscriptionEvent({
        stripeSubscriptionId: 'sub_stripe_1',
        stripeCustomerId: 'cus_123',
        stripeStatus: 'unpaid',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });

      expect(tenantLifecycle.syncStatusFromBilling).toHaveBeenCalledWith(
        'tenant-1',
        TenantStatus.SUSPENDED,
        {},
        expect.anything(),
      );
    });
  });
});
