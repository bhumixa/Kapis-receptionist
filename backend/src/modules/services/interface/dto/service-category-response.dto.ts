import { ApiProperty } from '@nestjs/swagger';

export class ServiceCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
