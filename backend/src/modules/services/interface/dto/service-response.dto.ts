import { ApiProperty } from '@nestjs/swagger';

export class ServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) categoryId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() priceCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() bufferTimeMinutes!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
