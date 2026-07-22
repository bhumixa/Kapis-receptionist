import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { WorkingHoursEntryDto } from './working-hours-entry.dto';

/** `PUT /employees/:id/working-hours` request body — full replace, any number of entries (split shifts allowed). */
export class UpdateWorkingHoursDto {
  @ApiProperty({ type: [WorkingHoursEntryDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursEntryDto)
  entries!: WorkingHoursEntryDto[];
}
