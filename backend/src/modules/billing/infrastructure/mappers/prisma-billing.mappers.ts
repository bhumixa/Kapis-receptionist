import {
  Coupon,
  Invoice,
  Payment,
  Plan,
  Subscription,
  WebhookLog,
} from '@prisma/client';
import { CouponEntity } from '../../domain/entities/coupon.entity';
import { InvoiceEntity } from '../../domain/entities/invoice.entity';
import { PaymentEntity } from '../../domain/entities/payment.entity';
import { PlanEntity } from '../../domain/entities/plan.entity';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';
import { WebhookLogEntity } from '../../domain/entities/webhook-log.entity';

export function toPlanEntity(row: Plan): PlanEntity {
  return { ...row };
}

export function toSubscriptionEntity(row: Subscription): SubscriptionEntity {
  return { ...row };
}

export function toInvoiceEntity(row: Invoice): InvoiceEntity {
  return { ...row };
}

export function toPaymentEntity(row: Payment): PaymentEntity {
  return { ...row };
}

export function toCouponEntity(row: Coupon): CouponEntity {
  return { ...row };
}

export function toWebhookLogEntity(row: WebhookLog): WebhookLogEntity {
  return { ...row };
}
