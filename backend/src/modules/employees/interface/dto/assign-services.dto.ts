import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** `PUT /employees/:id/services` request body — full replace of eligibility. */
export class AssignServicesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  serviceIds!: string[];
}
