import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** API_SPECIFICATION.md Section 4 `POST /auth/verify-email` request body. */
export class VerifyEmailDto {
  @ApiProperty({ example: 'abc123...' })
  @IsString()
  @MinLength(1)
  token: string;
}
