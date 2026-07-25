import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActorType, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantLifecycleService } from '../../tenants/application/tenant-lifecycle.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { SubscriptionEntity } from '../domain/entities/subscription.entity';
import {
  PLAN_REPOSITORY,
  type PlanRepositoryPort,
} from '../domain/ports/plan-repository.port';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepositoryPort,
} from '../domain/ports/subscription-repository.port';
import { EntitlementService, UsageSummary } from './entitlement.service';
import {
  callStripe,
  NoStripeSubscriptionException,
  PlanNotFoundException,
  SubscriptionAlreadyActiveOnPlanException,
  SubscriptionAlreadyCanceledException,
} from './exceptions/billing.exceptions';
import { StripeClient } from '../infrastructure/stripe-client';

/** Stripe's own subscription-status strings, mapped onto this platform's `SubscriptionStatus` enum. */
const STRIPE_STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  incomplete: SubscriptionStatus.INCOMPLETE,
  incomplete_expired: SubscriptionStatus.CANCELED,
  unpaid: SubscriptionStatus.UNPAID,
};

/**
 * Grace-period policy (PROJECT_REQUIREMENTS.md Section 22 Q9, resolved this
 * milestone, docs/adr/ADR-012-billing-and-subscriptions.md): `PAST_DUE`
 * stays fully functional; only `CANCELED`/`UNPAID` (Stripe's own dunning
 * retries exhausted) suspend the tenant. `INCOMPLETE` (initial payment
 * still processing) intentionally has no `Tenant.status` mapping — left
 * unchanged until Stripe resolves it one way or the other.
 */
const SUBSCRIPTION_TO_TENANT_STATUS: Partial<
  Record<SubscriptionStatus, TenantStatus>
> = {
  [SubscriptionStatus.TRIALING]: TenantStatus.TRIAL,
  [SubscriptionStatus.ACTIVE]: TenantStatus.ACTIVE,
  [SubscriptionStatus.PAST_DUE]: TenantStatus.PAST_DUE,
  [SubscriptionStatus.CANCELED]: TenantStatus.CANCELLED,
  [SubscriptionStatus.UNPAID]: TenantStatus.SUSPENDED,
};

export interface StripeSubscriptionSyncData {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripeStatus: string;
  stripePriceId?: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
}

/**
 * `GET/POST /subscriptions`, `.../cancel`, `.../reactivate`, `.../change-plan`
 * (API_SPECIFICATION.md Section 13). Owns every subscription-state
 * transition *except* Checkout Session creation (`CheckoutService`) and
 * Customer Portal sessions (`CustomerPortalService`) — those need a
 * `stripeCustomerId`-lazy-creation step this service doesn't otherwise need.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepositoryPort,
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepositoryPort,
    private readonly entitlements: EntitlementService,
    private readonly tenantLifecycle: TenantLifecycleService,
    private readonly stripeClient: StripeClient,
    private readonly auditLog: AuditLogService,
  ) {}

  async getForTenant(tenantId: string): Promise<UsageSummary> {
    return this.entitlements.getOrCreateForTenant(tenantId);
  }

  /**
   * Immediate plan change with Stripe proration for both upgrade and
   * downgrade — one code path (this milestone's approved decision). If the
   * tenant hasn't completed Checkout yet (no live Stripe subscription), the
   * change is purely local — it just determines which price Checkout uses
   * next.
   */
  async changePlan(
    tenantId: string,
    planId: string,
    actor: AccessTokenPayload,
  ): Promise<UsageSummary> {
    const { subscription: current } =
      await this.entitlements.getOrCreateForTenant(tenantId);
    if (current.planId === planId) {
      throw new SubscriptionAlreadyActiveOnPlanException();
    }

    const targetPlan = await this.plans.findById(planId);
    if (!targetPlan || !targetPlan.isActive) {
      throw new PlanNotFoundException();
    }

    if (current.stripeSubscriptionId) {
      await callStripe(() =>
        this.stripeClient.changeSubscriptionPrice(
          current.stripeSubscriptionId!,
          targetPlan.stripePriceId,
        ),
      );
    }

    const updated = await this.subscriptions.updateByTenantId(tenantId, {
      planId,
      updatedByType: ActorType.USER,
      updatedById: actor.sub,
    });

    await this.auditLog.record({
      action: 'SUBSCRIPTION_PLAN_CHANGED',
      entityType: 'Subscription',
      entityId: updated.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fromPlanId: current.planId, toPlanId: planId },
    });

    return { subscription: updated, plan: targetPlan };
  }

  /** Cancel-at-period-end (Business Rule 8: Owner only, enforced at the controller via `@RequirePermission('billing:manage')`). */
  async cancel(
    tenantId: string,
    actor: AccessTokenPayload,
  ): Promise<SubscriptionEntity> {
    const { subscription: current } =
      await this.entitlements.getOrCreateForTenant(tenantId);
    if (
      current.cancelAtPeriodEnd ||
      current.status === SubscriptionStatus.CANCELED
    ) {
      throw new SubscriptionAlreadyCanceledException();
    }

    let updated: SubscriptionEntity;
    if (current.stripeSubscriptionId) {
      await callStripe(() =>
        this.stripeClient.cancelAtPeriodEnd(current.stripeSubscriptionId!),
      );
      updated = await this.subscriptions.updateByTenantId(tenantId, {
        cancelAtPeriodEnd: true,
        updatedByType: ActorType.USER,
        updatedById: actor.sub,
      });
    } else {
      // Still trial-only, no live Stripe subscription to schedule a
      // cancellation on — nothing to bill out, so the cancellation is
      // immediate and final.
      updated = await this.subscriptions.updateByTenantId(tenantId, {
        status: SubscriptionStatus.CANCELED,
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
        updatedByType: ActorType.USER,
        updatedById: actor.sub,
      });
      await this.tenantLifecycle.syncStatusFromBilling(
        tenantId,
        TenantStatus.CANCELLED,
        {},
        { reason: 'trial-only cancellation, no Stripe subscription' },
      );
    }

    await this.auditLog.record({
      action: 'SUBSCRIPTION_CANCELED',
      entityType: 'Subscription',
      entityId: updated.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {
        hadStripeSubscription: Boolean(current.stripeSubscriptionId),
      },
    });

    return updated;
  }

  /** Undoes a pending `cancelAtPeriodEnd` — only meaningful while a live Stripe subscription still exists. */
  async reactivate(
    tenantId: string,
    actor: AccessTokenPayload,
  ): Promise<SubscriptionEntity> {
    const { subscription: current } =
      await this.entitlements.getOrCreateForTenant(tenantId);
    if (!current.cancelAtPeriodEnd || !current.stripeSubscriptionId) {
      throw new NoStripeSubscriptionException();
    }

    await callStripe(() =>
      this.stripeClient.resumeSubscription(current.stripeSubscriptionId!),
    );
    const updated = await this.subscriptions.updateByTenantId(tenantId, {
      cancelAtPeriodEnd: false,
      canceledAt: null,
      updatedByType: ActorType.USER,
      updatedById: actor.sub,
    });

    await this.auditLog.record({
      action: 'SUBSCRIPTION_REACTIVATED',
      entityType: 'Subscription',
      entityId: updated.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
    });

    return updated;
  }

  /**
   * Called by `StripeEventProcessorService` for every `customer.
   * subscription.*` event — the single place Stripe's subscription truth is
   * written back into this platform. Resolves tenant via `stripeCustomerId`
   * (the subscription may not carry a locally-known `stripeSubscriptionId`
   * yet on its very first `created` event).
   */
  async applyStripeSubscriptionEvent(
    data: StripeSubscriptionSyncData,
  ): Promise<void> {
    const existing = await this.subscriptions.findByStripeCustomerId(
      data.stripeCustomerId,
    );
    if (!existing) {
      this.logger.warn(
        `No local Subscription for Stripe customer ${data.stripeCustomerId} — dropping subscription sync event`,
      );
      return;
    }

    const mappedStatus = STRIPE_STATUS_MAP[data.stripeStatus];
    if (!mappedStatus) {
      this.logger.warn(
        `Unrecognized Stripe subscription status "${data.stripeStatus}" — leaving local status unchanged`,
      );
    }

    let planId = existing.planId;
    if (data.stripePriceId) {
      const plan = await this.plans.findByStripePriceId(data.stripePriceId);
      if (plan) {
        planId = plan.id;
      }
    }

    const updated = await this.subscriptions.updateByTenantId(
      existing.tenantId,
      {
        planId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        status: mappedStatus ?? existing.status,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        canceledAt: data.canceledAt,
        updatedByType: ActorType.SYSTEM,
        updatedById: null,
      },
    );

    await this.auditLog.record({
      action: 'SUBSCRIPTION_SYNCED_FROM_STRIPE',
      entityType: 'Subscription',
      entityId: updated.id,
      actorType: ActorType.SYSTEM,
      actorId: null,
      tenantId: existing.tenantId,
      metadata: { stripeStatus: data.stripeStatus, mappedStatus },
    });

    const tenantStatus = mappedStatus
      ? SUBSCRIPTION_TO_TENANT_STATUS[mappedStatus]
      : undefined;
    if (tenantStatus) {
      await this.tenantLifecycle.syncStatusFromBilling(
        existing.tenantId,
        tenantStatus,
        {},
        { stripeStatus: data.stripeStatus },
      );
    }
  }
}
