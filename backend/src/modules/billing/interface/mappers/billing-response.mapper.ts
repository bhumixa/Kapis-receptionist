import { InvoiceEntity } from '../../domain/entities/invoice.entity';
import { PaymentEntity } from '../../domain/entities/payment.entity';
import { PlanEntity } from '../../domain/entities/plan.entity';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';
import {
  InvoiceResponseDto,
  PaymentResponseDto,
} from '../dto/invoice-response.dto';
import { PlanResponseDto } from '../dto/plan-response.dto';
import { SubscriptionResponseDto } from '../dto/subscription-response.dto';

export function toPlanResponseDto(entity: PlanEntity): PlanResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    monthlyPriceCents: entity.monthlyPriceCents,
    currency: entity.currency,
    maxStaff: entity.maxStaff,
    maxMessagesPerMonth: entity.maxMessagesPerMonth,
    maxLocations: entity.maxLocations,
    maxAppointmentsPerMonth: entity.maxAppointmentsPerMonth,
    maxStorageMb: entity.maxStorageMb,
    isActive: entity.isActive,
    trialDays: entity.trialDays,
  };
}

export function toSubscriptionResponseDto(
  subscription: SubscriptionEntity,
  plan: PlanEntity,
): SubscriptionResponseDto {
  return {
    id: subscription.id,
    planId: subscription.planId,
    plan: toPlanResponseDto(plan),
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart
      ? subscription.currentPeriodStart.toISOString()
      : null,
    currentPeriodEnd: subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toISOString()
      : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt
      ? subscription.canceledAt.toISOString()
      : null,
    messagesUsedCurrentPeriod: subscription.messagesUsedCurrentPeriod,
    hasStripeSubscription: Boolean(subscription.stripeSubscriptionId),
  };
}

export function toInvoiceResponseDto(
  entity: InvoiceEntity,
): InvoiceResponseDto {
  return {
    id: entity.id,
    amountDueCents: entity.amountDueCents,
    amountPaidCents: entity.amountPaidCents,
    currency: entity.currency,
    status: entity.status,
    invoicePdfUrl: entity.invoicePdfUrl,
    issuedAt: entity.issuedAt.toISOString(),
    dueAt: entity.dueAt ? entity.dueAt.toISOString() : null,
    paidAt: entity.paidAt ? entity.paidAt.toISOString() : null,
  };
}

export function toPaymentResponseDto(
  entity: PaymentEntity,
): PaymentResponseDto {
  return {
    id: entity.id,
    invoiceId: entity.invoiceId,
    amountCents: entity.amountCents,
    currency: entity.currency,
    status: entity.status,
    failureMessage: entity.failureMessage,
    attemptedAt: entity.attemptedAt.toISOString(),
  };
}
