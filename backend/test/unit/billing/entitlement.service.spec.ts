import { SubscriptionStatus } from '@prisma/client';
import {
  EntitlementFeature,
  EntitlementService,
  NoDefaultPlanConfiguredError,
} from '../../../src/modules/billing/application/entitlement.service';
import { PlanLimitExceededException } from '../../../src/modules/billing/application/exceptions/billing.exceptions';
import { PlanEntity } from '../../../src/modules/billing/domain/entities/plan.entity';
import { PlanRepositoryPort } from '../../../src/modules/billing/domain/ports/plan-repository.port';
import { SubscriptionEntity } from '../../../src/modules/billing/domain/entities/subscription.entity';
import { SubscriptionRepositoryPort } from '../../../src/modules/billing/domain/ports/subscription-repository.port';

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

describe('EntitlementService', () => {
  let subscriptions: jest.Mocked<SubscriptionRepositoryPort>;
  let plans: jest.Mocked<PlanRepositoryPort>;
  let service: EntitlementService;

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
    service = new EntitlementService(subscriptions, plans);
  });

  describe('getOrCreateForTenant', () => {
    it('returns the existing subscription and plan when one already exists', async () => {
      subscriptions.findByTenantId.mockResolvedValue(makeSubscription());
      plans.findById.mockResolvedValue(makePlan());

      const result = await service.getOrCreateForTenant('tenant-1');

      expect(result.subscription.tenantId).toBe('tenant-1');
      expect(subscriptions.create).not.toHaveBeenCalled();
    });

    it('backfills a TRIALING subscription onto the cheapest active plan when none exists', async () => {
      subscriptions.findByTenantId.mockResolvedValue(null);
      plans.findDefault.mockResolvedValue(makePlan({ trialDays: 14 }));
      subscriptions.upsertTrialForTenant.mockResolvedValue(makeSubscription());
      plans.findById.mockResolvedValue(makePlan());

      await service.getOrCreateForTenant('tenant-2');

      expect(subscriptions.upsertTrialForTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-2',
          planId: 'plan-1',
          status: SubscriptionStatus.TRIALING,
        }),
      );
    });

    it('throws NoDefaultPlanConfiguredError when no active Plan exists', async () => {
      subscriptions.findByTenantId.mockResolvedValue(null);
      plans.findDefault.mockResolvedValue(null);

      await expect(service.getOrCreateForTenant('tenant-3')).rejects.toThrow(
        NoDefaultPlanConfiguredError,
      );
    });
  });

  describe('assertWithinLimit', () => {
    beforeEach(() => {
      subscriptions.findByTenantId.mockResolvedValue(makeSubscription());
      plans.findById.mockResolvedValue(makePlan({ maxStaff: 5 }));
    });

    it('allows usage below the limit', async () => {
      await expect(
        service.assertWithinLimit(
          'tenant-1',
          EntitlementFeature.EMPLOYEE_LIMIT,
          4,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws PlanLimitExceededException when usage has reached the limit', async () => {
      await expect(
        service.assertWithinLimit(
          'tenant-1',
          EntitlementFeature.EMPLOYEE_LIMIT,
          5,
        ),
      ).rejects.toThrow(PlanLimitExceededException);
    });

    it('never throws when the plan field is null (unlimited)', async () => {
      plans.findById.mockResolvedValue(makePlan({ maxStaff: null }));

      await expect(
        service.assertWithinLimit(
          'tenant-1',
          EntitlementFeature.EMPLOYEE_LIMIT,
          100_000,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkAndIncrementAiMessageUsage', () => {
    it('increments usage when under the monthly limit', async () => {
      subscriptions.findByTenantId.mockResolvedValue(
        makeSubscription({ messagesUsedCurrentPeriod: 500 }),
      );
      plans.findById.mockResolvedValue(makePlan({ maxMessagesPerMonth: 1000 }));

      await service.checkAndIncrementAiMessageUsage('tenant-1');

      expect(subscriptions.incrementMessagesUsed).toHaveBeenCalledWith(
        'tenant-1',
      );
    });

    it('throws PlanLimitExceededException and does not increment once the quota is reached', async () => {
      subscriptions.findByTenantId.mockResolvedValue(
        makeSubscription({ messagesUsedCurrentPeriod: 1000 }),
      );
      plans.findById.mockResolvedValue(makePlan({ maxMessagesPerMonth: 1000 }));

      await expect(
        service.checkAndIncrementAiMessageUsage('tenant-1'),
      ).rejects.toThrow(PlanLimitExceededException);
      expect(subscriptions.incrementMessagesUsed).not.toHaveBeenCalled();
    });
  });
});
