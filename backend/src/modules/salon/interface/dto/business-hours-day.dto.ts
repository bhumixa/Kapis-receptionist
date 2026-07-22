import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One day of `PUT /salon/business-hours`'s 7-entry body. `startTime`/
 * `endTime` are only required (and only validated) when `isClosed` is
 * false — cross-field rules (exactly 7 distinct days covering 0-6,
 * `endTime > startTime`) are enforced in `BusinessHoursService`, not here
 * (docs/SALON_ARCHITECTURE.md).
 */
export class BusinessHoursDayDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  @ValidateIf((day: BusinessHoursDayDto) => !day.isClosed)
  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'startTime must be in "HH:mm" format' })
  startTime!: string;

  @ApiProperty({ example: '18:00' })
  @ValidateIf((day: BusinessHoursDayDto) => !day.isClosed)
  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'endTime must be in "HH:mm" format' })
  endTime!: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  isClosed!: boolean;
}
