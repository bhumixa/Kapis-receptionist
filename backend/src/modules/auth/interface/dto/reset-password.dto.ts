import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../../common/constants/auth.constants';

/** API_SPECIFICATION.md Section 4 `POST /auth/reset-password` request body. */
export class ResetPasswordDto {
  @ApiProperty({ example: 'abc123...' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: 'N3wStr0ngP@ss!' })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/[A-Z]/, {
    message: 'newPassword must contain at least one uppercase letter',
  })
  @Matches(/[0-9]/, {
    message: 'newPassword must contain at least one number',
  })
  newPassword: string;
}
