import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ActorType } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { InternalServiceAuthGuard } from '../../../core/guards/internal-service-auth.guard';
import { IdempotencyInterceptor } from '../../../core/idempotency/idempotency.interceptor';
import type { AiActorContext } from '../../appointments/application/appointments.service';
import { ToolExecutorService } from '../application/tool-executor.service';
import { AiBookDto } from './dto/ai-book.dto';
import { AiCancelDto } from './dto/ai-cancel.dto';
import { AiFaqDto } from './dto/ai-faq.dto';
import { AiRescheduleDto } from './dto/ai-reschedule.dto';

/**
 * `POST /ai/tools/*` (API_SPECIFICATION.md Section 12) — internal-service
 * credential only, **not part of the frontend team's contract**
 * (`@ApiExcludeController`, matching `webhooks.controller.ts`'s precedent
 * for a non-Angular-facing surface). Real production tool execution runs
 * in-process via `ToolExecutorService` directly
 * (docs/adr/ADR-011-ai-receptionist.md) — these endpoints are a parallel,
 * equally-real HTTP surface over the exact same service, for QA/eval/
 * observability/future-extraction (Section 12's architectural note).
 */
@ApiExcludeController()
@Controller('ai/tools')
@UseGuards(InternalServiceAuthGuard)
export class AiToolsController {
  constructor(
    private readonly toolExecutor: ToolExecutorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('book')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async book(@Body() dto: AiBookDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const result = await this.toolExecutor.book(
      tenantId,
      toAiActor(dto.conversationId, dto.actorType),
      {
        customerId: dto.customerId,
        startTime: new Date(dto.startTime),
        services: dto.services,
        notes: dto.notes ?? null,
      },
    );
    return result;
  }

  @Post('reschedule')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  async reschedule(@Body() dto: AiRescheduleDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const result = await this.toolExecutor.reschedule(
      tenantId,
      dto.appointmentId,
      toAiActor(dto.conversationId, dto.actorType),
      {
        newStartTime: new Date(dto.newStartTime),
        services: dto.services,
      },
    );
    return result;
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  async cancel(@Body() dto: AiCancelDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const result = await this.toolExecutor.cancel(
      tenantId,
      dto.appointmentId,
      dto.reason,
      toAiActor(dto.conversationId, dto.actorType),
    );
    return result;
  }

  @Post('faq')
  @HttpCode(HttpStatus.OK)
  async faq(@Body() dto: AiFaqDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const result = await this.toolExecutor.answerFaq(tenantId, dto.question);
    return result;
  }
}

function toAiActor(
  conversationId: string,
  actorType: 'AI' | 'CUSTOMER',
): AiActorContext {
  return {
    actorType: actorType === 'AI' ? ActorType.AI : ActorType.CUSTOMER,
    conversationId,
  };
}
