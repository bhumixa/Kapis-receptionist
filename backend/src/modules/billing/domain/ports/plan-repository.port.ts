import { PlanEntity } from '../entities/plan.entity';

export const PLAN_REPOSITORY = Symbol('PLAN_REPOSITORY');

export interface UpdatePlanInput {
  name?: string;
  stripePriceId?: string;
  monthlyPriceCents?: number;
  currency?: string;
  maxStaff?: number | null;
  maxMessagesPerMonth?: number | null;
  maxLocations?: number;
  maxAppointmentsPerMonth?: number | null;
  maxStorageMb?: number | null;
  isActive?: boolean;
  trialDays?: number;
}

export interface PlanRepositoryPort {
  findActive(): Promise<PlanEntity[]>;
  findById(id: string): Promise<PlanEntity | null>;
  findByStripePriceId(stripePriceId: string): Promise<PlanEntity | null>;
  /** Cheapest active plan — the default a new trial subscription is created against. */
  findDefault(): Promise<PlanEntity | null>;
  findAll(): Promise<PlanEntity[]>;
  update(id: string, data: UpdatePlanInput): Promise<PlanEntity>;
}
