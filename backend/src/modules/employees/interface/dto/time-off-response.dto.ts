import { ApiProperty } from '@nestjs/swagger';

export class TimeOffResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty() createdAt!: string;
}
