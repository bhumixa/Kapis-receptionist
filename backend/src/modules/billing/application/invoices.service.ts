import { Inject, Injectable } from '@nestjs/common';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepositoryPort,
  type ListInvoicesResult,
} from '../domain/ports/invoice-repository.port';
import {
  PAYMENT_REPOSITORY,
  type ListPaymentsResult,
  type PaymentRepositoryPort,
} from '../domain/ports/payment-repository.port';

/** `GET /invoices`, `GET /payments` (API_SPECIFICATION.md Section 13) — read-only, synced from Stripe webhooks only. */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: InvoiceRepositoryPort,
    @Inject(PAYMENT_REPOSITORY)
    private readonly payments: PaymentRepositoryPort,
  ) {}

  async listForTenant(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<ListInvoicesResult> {
    return this.invoices.findForTenant(tenantId, { page, pageSize });
  }

  async listPaymentsForTenant(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<ListPaymentsResult> {
    return this.payments.findForTenant(tenantId, { page, pageSize });
  }
}
