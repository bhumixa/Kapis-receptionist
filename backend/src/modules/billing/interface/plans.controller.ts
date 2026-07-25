import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBooleanString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlansService } from '../application/plans.service';
import { toPlanResponseDto } from './mappers/billing-response.mapper';

class ListPlansQueryDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

/** `GET /plans` (API_SPECIFICATION.md Section 13) — public, no auth, small/static list. */
@ApiTags('Billing')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async list(@Query() query: ListPlansQueryDto) {
    const includeInactive = query.isActive === 'false';
    const plans = includeInactive
      ? await this.plansService.listAllPlans()
      : await this.plansService.listActivePlans();
    return plans.map(toPlanResponseDto);
  }
}
