import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** `POST /subscriptions/change-plan` request body. */
export class ChangePlanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;
}
