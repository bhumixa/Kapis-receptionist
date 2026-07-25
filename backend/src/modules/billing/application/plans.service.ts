import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { PlanEntity } from '../domain/entities/plan.entity';
import {
  PLAN_REPOSITORY,
  type PlanRepositoryPort,
  type UpdatePlanInput,
} from '../domain/ports/plan-repository.port';
import { PlanNotFoundException } from './exceptions/billing.exceptions';

/**
 * `GET /plans` (public, no auth — API_SPECIFICATION.md Section 13) and the
 * Platform Admin plan-management endpoints (`modules/admin`). Plan CRUD is
 * intentionally thin — Plan rows are Stripe Price mirrors, not a
 * general-purpose pricing engine.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listActivePlans(): Promise<PlanEntity[]> {
    return this.plans.findActive();
  }

  async listAllPlans(): Promise<PlanEntity[]> {
    return this.plans.findAll();
  }

  async getPlanOrThrow(id: string): Promise<PlanEntity> {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new PlanNotFoundException();
    }
    return plan;
  }

  /** Super Admin only (`modules/admin`) — retired plans are deactivated, never deleted (existing subscriptions must keep a valid FK). */
  async updatePlan(
    id: string,
    input: UpdatePlanInput,
    actor: AccessTokenPayload,
  ): Promise<PlanEntity> {
    await this.getPlanOrThrow(id);
    const updated = await this.plans.update(id, input);

    await this.auditLog.record({
      action: 'PLAN_UPDATED',
      entityType: 'Plan',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId: null,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }
}
