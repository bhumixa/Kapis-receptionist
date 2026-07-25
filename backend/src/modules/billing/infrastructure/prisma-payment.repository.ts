import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PaymentEntity } from '../domain/entities/payment.entity';
import {
  ListPaymentsFilter,
  ListPaymentsResult,
  PaymentRepositoryPort,
  UpsertPaymentInput,
} from '../domain/ports/payment-repository.port';
import { toPaymentEntity } from './mappers/prisma-billing.mappers';

@Injectable()
export class PrismaPaymentRepository implements PaymentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByStripePaymentIntentId(
    input: UpsertPaymentInput,
  ): Promise<PaymentEntity> {
    const row = await this.prisma.payment.upsert({
      where: { stripePaymentIntentId: input.stripePaymentIntentId },
      create: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: input.status,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        attemptedAt: input.attemptedAt,
      },
      update: {
        status: input.status,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      },
    });
    return toPaymentEntity(row);
  }

  async findForTenant(
    tenantId: string,
    filter: ListPaymentsFilter,
  ): Promise<ListPaymentsResult> {
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId },
        orderBy: { attemptedAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.payment.count({ where: { tenantId } }),
    ]);
    return { items: items.map(toPaymentEntity), total };
  }
}
