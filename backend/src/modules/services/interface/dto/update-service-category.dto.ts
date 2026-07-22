import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/** `PATCH /service-categories/:id` request body — all fields optional, at least one required. */
export class UpdateServiceCategoryDto {
  @ApiPropertyOptional({ example: 'Hair & Styling' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
