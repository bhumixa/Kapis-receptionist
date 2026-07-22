import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsHexColor,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/** `PATCH /employees/:id` request body — all fields optional. `userId: null` unlinks the login account. */
export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber()
  phoneNumber?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  colorTag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  serviceIds?: string[];
}
