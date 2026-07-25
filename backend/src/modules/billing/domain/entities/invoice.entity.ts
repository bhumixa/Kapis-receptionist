import { InvoiceStatus } from '@prisma/client';

/** Synced from Stripe webhooks only — never created directly by application code. */
export interface InvoiceEntity {
  id: string;
  tenantId: string;
  subscriptionId: string;
  stripeInvoiceId: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: InvoiceStatus;
  invoicePdfUrl: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
