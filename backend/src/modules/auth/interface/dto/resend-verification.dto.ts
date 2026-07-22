import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** API_SPECIFICATION.md Section 4 `POST /auth/resend-verification` request body. */
export class ResendVerificationDto {
  @ApiProperty({ example: 'owner@salon.com' })
  @IsEmail()
  email: string;
}
