import { Inject, Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PlanEntity } from '../domain/entities/plan.entity';
import { SubscriptionEntity } from '../domain/entities/subscription.entity';
import {
  PLAN_REPOSITORY,
  type PlanRepositoryPort,
} from '../domain/ports/plan-repository.port';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepositoryPort,
} from '../domain/ports/subscription-repository.port';
import { PlanLimitExceededException } from './exceptions/billing.exceptions';

/**
 * Every feature-gated limit this milestone enforces (docs/FEATURE_
 * ENTITLEMENTS.md). `STORAGE` is intentionally a member with no enforcement
 * call site — `Plan.maxStorageMb` is carried on the schema but no Files/S3
 * module exists yet to meter real usage against it (a documented gap, not
 * an oversight).
 */
export enum EntitlementFeature {
  EMPLOYEE_LIMIT = 'EMPLOYEE_LIMIT',
  APPOINTMENT_LIMIT = 'APPOINTMENT_LIMIT',
  AI_MESSAGE_LIMIT = 'AI_MESSAGE_LIMIT',
  STORAGE = 'STORAGE',
}

const FEATURE_LABEL: Record<EntitlementFeature, string> = {
  [EntitlementFeature.EMPLOYEE_LIMIT]: 'staff',
  [EntitlementFeature.APPOINTMENT_LIMIT]: 'monthly appointment',
  [EntitlementFeature.AI_MESSAGE_LIMIT]: 'monthly AI/WhatsApp conversation',
  [EntitlementFeature.STORAGE]: 'storage',
};

function resolveLimit(
  plan: PlanEntity,
  feature: EntitlementFeature,
): number | null {
  switch (feature) {
    case EntitlementFeature.EMPLOYEE_LIMIT:
      return plan.maxStaff;
    case EntitlementFeature.APPOINTMENT_LIMIT:
      return plan.maxAppointmentsPerMonth;
    case EntitlementFeature.AI_MESSAGE_LIMIT:
      return plan.maxMessagesPerMonth;
    case EntitlementFeature.STORAGE:
      return plan.maxStorageMb;
  }
}

export interface UsageSummary {
  subscription: SubscriptionEntity;
  plan: PlanEntity;
}

/**
 * The single centralized feature-entitlement gate (milestone requirement:
 * "every module must use the centralized entitlement service instead of
 * checking plan names directly"). Every consuming module — Employees,
 * Appointments, WhatsApp/AI — passes in a *count it already computed from
 * its own repository* (`assertWithinLimit`); this service never reaches
 * into another module's data, which is what keeps `BillingModule` from
 * needing a circular dependency on every module it gates (contrast with
 * the genuine, necessary `AiModule`<->`WhatsAppModule` cycle,
 * docs/adr/ADR-011-ai-receptionist.md) — `EntitlementService` only ever
 * reads its own module's `Subscription`/`Plan` data.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepositoryPort,
    @Inject(PLAN_REPOSITORY)
    private readonly plans: PlanRepositoryPort,
  ) {}

  /**
   * Defensive backfill (same precedent as `TenantSettingsService.getSettings`
   * — docs/TENANT_ARCHITECTURE.md Section 2.2): any tenant reaching an
   * entitlement check without a `Subscription` row (a tenant seeded
   * directly via Prisma bypassing `POST /auth/register`, or one that
   * predates this migration) is transparently upserted onto the cheapest
   * active `Plan` in `TRIALING` status, rather than throwing. Requires no
   * Stripe call — `stripeCustomerId` is nullable precisely so this backfill
   * never depends on a live network call (see the Prisma schema's doc
   * comment on `Subscription`).
   */
  async getOrCreateForTenant(tenantId: string): Promise<UsageSummary> {
    let subscription = await this.subscriptions.findByTenantId(tenantId);

    if (!subscription) {
      const defaultPlan = await this.plans.findDefault();
      if (!defaultPlan) {
        // No active Plan configured at all — a platform configuration gap,
        // not a per-tenant problem. Fail open (log loudly, don't block
        // every tenant-scoped write in the platform) rather than fail
        // closed on an ops mistake.
        this.logger.error(
          `No active Plan exists — cannot backfill a Subscription for tenant ${tenantId}. Failing open.`,
        );
        throw new NoDefaultPlanConfiguredError();
      }

      const now = new Date();
      const trialEnd = new Date(
        now.getTime() + defaultPlan.trialDays * 24 * 60 * 60 * 1000,
      );
      subscription = await this.subscriptions.upsertTrialForTenant({
        tenantId,
        planId: defaultPlan.id,
        status: SubscriptionStatus.TRIALING,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
      });
      this.logger.log(
        `Backfilled a TRIALING Subscription for tenant ${tenantId} onto plan ${defaultPlan.name}`,
      );
    }

    const plan = await this.plans.findById(subscription.planId);
    if (!plan) {
      throw new NoDefaultPlanConfiguredError();
    }

    return { subscription, plan };
  }

  /**
   * Throws `PlanLimitExceededException` (403) if `currentUsage` has already
   * reached the plan's limit for `feature`. `null`/`undefined` limit means
   * unlimited. Callers pass a count they've already computed from their own
   * repository — see the class doc comment for why.
   */
  async assertWithinLimit(
    tenantId: string,
    feature: EntitlementFeature,
    currentUsage: number,
  ): Promise<void> {
    const { plan } = await this.getOrCreateForTenant(tenantId);
    const limit = resolveLimit(plan, feature);
    if (limit !== null && currentUsage >= limit) {
      throw new PlanLimitExceededException(FEATURE_LABEL[feature], limit);
    }
  }

  /**
   * AI/WhatsApp conversation quota (covers both "AI conversation quota" and
   * "WhatsApp conversation quota" from the milestone brief — see the
   * `Subscription.messagesUsedCurrentPeriod` schema doc comment for why one
   * counter suffices). Check-then-increment, not perfectly atomic under
   * concurrency — the same accepted tradeoff `AiRateLimitGuard`'s
   * fixed-window counter already makes; a monthly quota being off by a
   * handful of messages under a race is not worth a distributed lock.
   */
  async checkAndIncrementAiMessageUsage(tenantId: string): Promise<void> {
    const { subscription, plan } = await this.getOrCreateForTenant(tenantId);
    if (
      plan.maxMessagesPerMonth !== null &&
      subscription.messagesUsedCurrentPeriod >= plan.maxMessagesPerMonth
    ) {
      throw new PlanLimitExceededException(
        FEATURE_LABEL[EntitlementFeature.AI_MESSAGE_LIMIT],
        plan.maxMessagesPerMonth,
      );
    }
    await this.subscriptions.incrementMessagesUsed(tenantId);
  }

  async getUsageSummary(tenantId: string): Promise<UsageSummary> {
    return this.getOrCreateForTenant(tenantId);
  }
}

export class NoDefaultPlanConfiguredError extends Error {
  constructor() {
    super('No active Plan is configured on the platform.');
    this.name = 'NoDefaultPlanConfiguredError';
  }
}
