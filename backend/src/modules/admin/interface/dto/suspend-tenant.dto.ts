import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendTenantDto {
  @ApiPropertyOptional({
    example: 'Repeated policy violation reported by a customer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
