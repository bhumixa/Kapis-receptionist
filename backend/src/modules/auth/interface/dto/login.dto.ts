import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/** API_SPECIFICATION.md Section 4 `POST /auth/login` request body. */
export class LoginDto {
  @ApiProperty({ example: 'owner@salon.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ss!' })
  @IsString()
  @MinLength(1)
  password: string;
}
