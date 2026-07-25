import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { InvoiceEntity } from '../domain/entities/invoice.entity';
import {
  InvoiceRepositoryPort,
  ListInvoicesFilter,
  ListInvoicesResult,
  UpsertInvoiceInput,
} from '../domain/ports/invoice-repository.port';
import { toInvoiceEntity } from './mappers/prisma-billing.mappers';

@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByStripeInvoiceId(
    stripeInvoiceId: string,
  ): Promise<InvoiceEntity | null> {
    const row = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId },
    });
    return row ? toInvoiceEntity(row) : null;
  }

  /** Idempotent — Stripe may deliver `invoice.paid`/`invoice.finalized` more than once for the same invoice. */
  async upsertByStripeInvoiceId(
    input: UpsertInvoiceInput,
  ): Promise<InvoiceEntity> {
    const row = await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: input.stripeInvoiceId },
      create: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        stripeInvoiceId: input.stripeInvoiceId,
        amountDueCents: input.amountDueCents,
        amountPaidCents: input.amountPaidCents,
        currency: input.currency,
        status: input.status,
        invoicePdfUrl: input.invoicePdfUrl,
        issuedAt: input.issuedAt,
        dueAt: input.dueAt,
        paidAt: input.paidAt,
      },
      update: {
        amountDueCents: input.amountDueCents,
        amountPaidCents: input.amountPaidCents,
        status: input.status,
        invoicePdfUrl: input.invoicePdfUrl,
        dueAt: input.dueAt,
        paidAt: input.paidAt,
      },
    });
    return toInvoiceEntity(row);
  }

  async findForTenant(
    tenantId: string,
    filter: ListInvoicesFilter,
  ): Promise<ListInvoicesResult> {
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { tenantId },
        orderBy: { issuedAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.invoice.count({ where: { tenantId } }),
    ]);
    return { items: items.map(toInvoiceEntity), total };
  }
}
