import { ActorType, SubscriptionStatus } from '@prisma/client';

/**
 * 1:1 with Tenant. `status` is authoritatively driven by Stripe webhooks
 * (`StripeEventProcessorService`) — application code elsewhere only reads
 * this, never writes `status` directly. `stripeCustomerId` is nullable: a
 * trial subscription created at registration has no Stripe Customer yet
 * (see the Prisma schema's doc comment on `Subscription` for the full
 * rationale) — one is created lazily on first Checkout.
 */
export interface SubscriptionEntity {
  id: string;
  tenantId: string;
  planId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  couponId: string | null;
  messagesUsedCurrentPeriod: number;
  createdAt: Date;
  updatedAt: Date;
  updatedByType: ActorType;
  updatedById: string | null;
}
