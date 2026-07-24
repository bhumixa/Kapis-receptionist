import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/** `POST /customers` request body (API_SPECIFICATION.md Section 9). */
export class CreateCustomerDto {
  @ApiProperty({ example: '+5511999999999' })
  @IsString()
  @Matches(E164_PATTERN, { message: 'phoneNumber must be in E.164 format' })
  phoneNumber!: string;

  @ApiPropertyOptional({ example: 'Sofia' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Reyes' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'sofia@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'pt' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  preferredLanguage?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}
