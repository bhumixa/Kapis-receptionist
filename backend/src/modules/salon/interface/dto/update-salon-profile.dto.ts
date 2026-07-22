import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsISO4217CurrencyCode,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsIanaTimezone } from '../../../../common/validators/is-iana-timezone.validator';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * `PATCH /salon` request body (docs/SALON_ARCHITECTURE.md) — every field
 * optional, spans both Tenant-owned fields (mirrors `UpdateTenantDto`
 * exactly, since `SalonProfileService` forwards these to
 * `TenantService.updateProfile`) and the new `SalonProfile`-owned fields.
 */
export class UpdateSalonProfileDto {
  // --- Tenant-owned (mirrors modules/tenants/interface/dto/update-tenant.dto.ts) ---

  @ApiPropertyOptional({ example: 'Bella Salon' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a 2-letter ISO 3166-1 alpha-2 code',
  })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'America/Sao_Paulo' })
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;

  @ApiPropertyOptional({ example: 'pt' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLocale?: string;

  // --- SalonProfile-owned (new this milestone) ---

  @ApiPropertyOptional({ example: 'A full-service salon in the city center.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'hello@bellasalon.com' })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional()
  @IsPhoneNumber()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://bellasalon.com' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#4A90D9' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, {
    message: 'primaryColor must be a hex color like #RRGGBB',
  })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#F5A623' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, {
    message: 'secondaryColor must be a hex color like #RRGGBB',
  })
  secondaryColor?: string;
}
