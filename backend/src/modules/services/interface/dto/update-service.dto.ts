import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/** `PATCH /services/:id` request body — all fields optional. `categoryId: null` un-categorizes the service. */
export class UpdateServiceDto {
  @ApiPropertyOptional({ example: 'uuid | null', nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ minimum: 5, maximum: 480 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Cleanup/prep buffer after this service, in minutes.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  bufferTimeMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
