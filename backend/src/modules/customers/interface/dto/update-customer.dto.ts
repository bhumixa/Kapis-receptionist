import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * `PATCH /customers/:id` request body — deliberately omits `phoneNumber`
 * (API_SPECIFICATION.md Section 9: changing a customer's WhatsApp identity
 * via a simple PATCH would silently merge two distinct identities; that
 * requires a dedicated future "merge customers" operation, not this
 * endpoint).
 */
export class UpdateCustomerDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}
