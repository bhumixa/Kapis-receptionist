import { ActorType, Prisma, SubscriptionStatus } from '@prisma/client';
import { SubscriptionEntity } from '../entities/subscription.entity';

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

export interface CreateSubscriptionInput {
  tenantId: string;
  planId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status?: SubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}

export interface UpdateSubscriptionInput {
  planId?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status?: SubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  couponId?: string | null;
  messagesUsedCurrentPeriod?: number;
  updatedByType?: ActorType;
  updatedById?: string | null;
}

export interface SubscriptionRepositoryPort {
  findByTenantId(tenantId: string): Promise<SubscriptionEntity | null>;
  findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<SubscriptionEntity | null>;
  findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionEntity | null>;
  /**
   * Accepts an optional Prisma transaction client so registration
   * (`PrismaRegistrationRepository`) can create Tenant + User + TenantSettings
   * + Subscription atomically in one transaction, matching the existing
   * precedent for that endpoint.
   */
  create(
    input: CreateSubscriptionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SubscriptionEntity>;
  /**
   * Atomic (single-statement `INSERT ... ON CONFLICT`) backfill for
   * `EntitlementService.getOrCreateForTenant` — a plain check-then-`create`
   * would race under concurrent first-access requests for the same tenant
   * (multiple requests all observing "no Subscription yet" and all
   * attempting to create one, tripping `tenantId`'s unique constraint on
   * every loser). Mirrors `TenantSettingsService`/`PrismaTenantSettingsRepository
   * .createDefault`'s exact upsert-with-`update: {}` precedent.
   */
  upsertTrialForTenant(
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionEntity>;
  updateByTenantId(
    tenantId: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionEntity>;
  /** Atomic increment — avoids a read-modify-write race under concurrent inbound messages. */
  incrementMessagesUsed(tenantId: string, by?: number): Promise<number>;
  resetMessagesUsed(tenantId: string): Promise<void>;
}
