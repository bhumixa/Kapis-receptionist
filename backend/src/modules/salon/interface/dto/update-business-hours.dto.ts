import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { BUSINESS_HOURS_DAYS_PER_WEEK } from '../../domain/entities/business-hours.entity';
import { BusinessHoursDayDto } from './business-hours-day.dto';

/** `PUT /salon/business-hours` request body — always the full week, exactly 7 entries. */
export class UpdateBusinessHoursDto {
  @ApiProperty({ type: [BusinessHoursDayDto] })
  @IsArray()
  @ArrayMinSize(BUSINESS_HOURS_DAYS_PER_WEEK)
  @ArrayMaxSize(BUSINESS_HOURS_DAYS_PER_WEEK)
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursDayDto)
  days!: BusinessHoursDayDto[];
}
