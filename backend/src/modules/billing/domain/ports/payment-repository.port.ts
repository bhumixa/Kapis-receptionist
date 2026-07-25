import { PaymentStatus } from '@prisma/client';
import { PaymentEntity } from '../entities/payment.entity';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface UpsertPaymentInput {
  tenantId: string;
  invoiceId: string | null;
  stripePaymentIntentId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  failureCode: string | null;
  failureMessage: string | null;
  attemptedAt: Date;
}

export interface ListPaymentsFilter {
  page: number;
  pageSize: number;
}

export interface ListPaymentsResult {
  items: PaymentEntity[];
  total: number;
}

export interface PaymentRepositoryPort {
  upsertByStripePaymentIntentId(
    input: UpsertPaymentInput,
  ): Promise<PaymentEntity>;
  findForTenant(
    tenantId: string,
    filter: ListPaymentsFilter,
  ): Promise<ListPaymentsResult>;
}
