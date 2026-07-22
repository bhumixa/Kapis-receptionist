import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** API_SPECIFICATION.md Section 4 `POST /auth/forgot-password` request body. */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'owner@salon.com' })
  @IsEmail()
  email: string;
}
