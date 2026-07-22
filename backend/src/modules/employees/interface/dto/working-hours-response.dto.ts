import { ApiProperty } from '@nestjs/swagger';

export class WorkingHoursResponseDto {
  @ApiProperty() dayOfWeek!: number;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty() isActive!: boolean;
}
