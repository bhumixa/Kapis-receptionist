import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsHexColor,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/** `POST /employees` request body. */
export class CreateEmployeeDto {
  @ApiProperty({ example: 'Ana' })
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ example: 'Silva' })
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+5511999999999' })
  @IsOptional()
  @IsPhoneNumber()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '#4F46E5' })
  @IsOptional()
  @IsHexColor()
  colorTag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    description:
      'Links to an existing User in this tenant for dashboard login access.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  serviceIds?: string[];
}
