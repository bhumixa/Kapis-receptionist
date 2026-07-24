import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** `POST /appointments/:id/cancel` request body (API_SPECIFICATION.md Section 10). */
export class CancelAppointmentDto {
  @ApiPropertyOptional({ example: 'Customer requested via phone.' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reason?: string;
}
