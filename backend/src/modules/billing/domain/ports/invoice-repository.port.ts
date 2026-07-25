import { InvoiceStatus } from '@prisma/client';
import { InvoiceEntity } from '../entities/invoice.entity';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export interface UpsertInvoiceInput {
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
}

export interface ListInvoicesFilter {
  page: number;
  pageSize: number;
}

export interface ListInvoicesResult {
  items: InvoiceEntity[];
  total: number;
}

export interface InvoiceRepositoryPort {
  findByStripeInvoiceId(stripeInvoiceId: string): Promise<InvoiceEntity | null>;
  /** Idempotent by `stripeInvoiceId` — Stripe may resend the same invoice event more than once. */
  upsertByStripeInvoiceId(input: UpsertInvoiceInput): Promise<InvoiceEntity>;
  findForTenant(
    tenantId: string,
    filter: ListInvoicesFilter,
  ): Promise<ListInvoicesResult>;
}
