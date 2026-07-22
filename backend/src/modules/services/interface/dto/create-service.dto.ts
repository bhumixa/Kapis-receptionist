import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/** `POST /services` request body. */
export class CreateServiceDto {
  @ApiPropertyOptional({ example: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 'Haircut & Blow-Dry' })
  @IsString()
  @Length(1, 150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 45, minimum: 5, maximum: 480 })
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes!: number;

  @ApiProperty({ example: 8000, description: 'Minor units (cents)' })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Cleanup/prep buffer after this service, in minutes.',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  bufferTimeMinutes?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
