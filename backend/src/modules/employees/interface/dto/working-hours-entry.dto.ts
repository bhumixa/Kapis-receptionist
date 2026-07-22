import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Matches, Max, Min } from 'class-validator';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One row of `PUT /employees/:id/working-hours`'s request body. */
export class WorkingHoursEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sunday..6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'startTime must be in "HH:mm" format' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'endTime must be in "HH:mm" format' })
  endTime!: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  isActive!: boolean;
}
