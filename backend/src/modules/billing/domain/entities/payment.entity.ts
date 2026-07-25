import { PaymentStatus } from '@prisma/client';

/** A payment attempt can exist before/without a finalized Invoice in some Stripe flows. */
export interface PaymentEntity {
  id: string;
  tenantId: string;
  invoiceId: string | null;
  stripePaymentIntentId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  failureCode: string | null;
  failureMessage: string | null;
  attemptedAt: Date;
  createdAt: Date;
}
