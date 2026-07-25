import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { SubscriptionEntity } from '../domain/entities/subscription.entity';
import {
  CreateSubscriptionInput,
  SubscriptionRepositoryPort,
  UpdateSubscriptionInput,
} from '../domain/ports/subscription-repository.port';
import { toSubscriptionEntity } from './mappers/prisma-billing.mappers';

/**
 * 1:1 with Tenant (`tenantId` is `@unique`) — every lookup here is keyed by
 * `tenantId`, not a synthetic `(tenantId, id)` pair, so this deliberately
 * does not extend `TenantScopedRepository` (same precedent as
 * `TenantSettings`, docs/TENANT_ARCHITECTURE.md Section 4).
 */
@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    return row ? toSubscriptionEntity(row) : null;
  }

  async findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId },
    });
    return row ? toSubscriptionEntity(row) : null;
  }

  async findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    return row ? toSubscriptionEntity(row) : null;
  }

  async create(
    input: CreateSubscriptionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SubscriptionEntity> {
    const client = tx ?? this.prisma;
    const row = await client.subscription.create({
      data: {
        tenantId: input.tenantId,
        planId: input.planId,
        stripeCustomerId: input.stripeCustomerId ?? null,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
      },
    });
    return toSubscriptionEntity(row);
  }

  async upsertTrialForTenant(
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionEntity> {
    try {
      const row = await this.prisma.subscription.upsert({
        where: { tenantId: input.tenantId },
        update: {},
        create: {
          tenantId: input.tenantId,
          planId: input.planId,
          status: input.status,
          currentPeriodStart: input.currentPeriodStart ?? null,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
        },
      });
      return toSubscriptionEntity(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.subscription.findUnique({
          where: { tenantId: input.tenantId },
        });
        if (existing) {
          return toSubscriptionEntity(existing);
        }
      }
      throw error;
    }
  }

  async updateByTenantId(
    tenantId: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionEntity> {
    const row = await this.prisma.subscription.update({
      where: { tenantId },
      data: input,
    });
    return toSubscriptionEntity(row);
  }

  async incrementMessagesUsed(tenantId: string, by = 1): Promise<number> {
    const row = await this.prisma.subscription.update({
      where: { tenantId },
      data: { messagesUsedCurrentPeriod: { increment: by } },
      select: { messagesUsedCurrentPeriod: true },
    });
    return row.messagesUsedCurrentPeriod;
  }

  async resetMessagesUsed(tenantId: string): Promise<void> {
    await this.prisma.subscription.update({
      where: { tenantId },
      data: { messagesUsedCurrentPeriod: 0 },
    });
  }
}
