import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsIanaTimezone } from '../../../../common/validators/is-iana-timezone.validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../../common/constants/auth.constants';

/** API_SPECIFICATION.md Section 4 `POST /auth/register` request body. */
export class RegisterDto {
  @ApiProperty({ example: 'owner@salon.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ss!' })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/[A-Z]/, {
    message: 'password must contain at least one uppercase letter',
  })
  @Matches(/[0-9]/, { message: 'password must contain at least one number' })
  password: string;

  @ApiProperty({ example: 'Maria' })
  @IsString()
  @Length(1, 100)
  firstName: string;

  @ApiProperty({ example: 'Gomez' })
  @IsString()
  @Length(1, 100)
  lastName: string;

  @ApiProperty({ example: 'Bella Salon' })
  @IsString()
  @Length(1, 100)
  tenantName: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  @IsIanaTimezone()
  timezone: string;
}
