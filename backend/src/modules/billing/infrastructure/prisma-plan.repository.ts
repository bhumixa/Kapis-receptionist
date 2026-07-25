import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PlanEntity } from '../domain/entities/plan.entity';
import {
  PlanRepositoryPort,
  UpdatePlanInput,
} from '../domain/ports/plan-repository.port';
import { toPlanEntity } from './mappers/prisma-billing.mappers';

/** Global reference data — no tenant scoping. */
@Injectable()
export class PrismaPlanRepository implements PlanRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(): Promise<PlanEntity[]> {
    const rows = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: 'asc' },
    });
    return rows.map(toPlanEntity);
  }

  async findById(id: string): Promise<PlanEntity | null> {
    const row = await this.prisma.plan.findUnique({ where: { id } });
    return row ? toPlanEntity(row) : null;
  }

  async findByStripePriceId(stripePriceId: string): Promise<PlanEntity | null> {
    const row = await this.prisma.plan.findUnique({
      where: { stripePriceId },
    });
    return row ? toPlanEntity(row) : null;
  }

  async findDefault(): Promise<PlanEntity | null> {
    const row = await this.prisma.plan.findFirst({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: 'asc' },
    });
    return row ? toPlanEntity(row) : null;
  }

  async findAll(): Promise<PlanEntity[]> {
    const rows = await this.prisma.plan.findMany({
      orderBy: { monthlyPriceCents: 'asc' },
    });
    return rows.map(toPlanEntity);
  }

  async update(id: string, data: UpdatePlanInput): Promise<PlanEntity> {
    const row = await this.prisma.plan.update({ where: { id }, data });
    return toPlanEntity(row);
  }
}
