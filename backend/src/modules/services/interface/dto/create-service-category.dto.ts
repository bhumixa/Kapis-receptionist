import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/** `POST /service-categories` request body. */
export class CreateServiceCategoryDto {
  @ApiProperty({ example: 'Hair' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
