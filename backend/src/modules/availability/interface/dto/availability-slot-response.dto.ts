import { ApiProperty } from '@nestjs/swagger';

export class AvailabilitySlotResponseDto {
  @ApiProperty() employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
}
