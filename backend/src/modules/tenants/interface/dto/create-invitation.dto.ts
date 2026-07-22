import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { IsEmail, IsIn } from 'class-validator';

/**
 * `POST /tenant/invitations` request body. Only `MANAGER`/`STAFF` are
 * assignable via invite — `OWNER` cannot be invited (only via account
 * transfer, out of scope) and `SUPER_ADMIN` is never assignable through
 * this endpoint (API_SPECIFICATION.md Section 5's `POST /users` note,
 * applied identically here).
 */
export class CreateInvitationDto {
  @ApiProperty({ example: 'ana@salon.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: [RoleName.MANAGER, RoleName.STAFF] })
  @IsIn([RoleName.MANAGER, RoleName.STAFF])
  role: typeof RoleName.MANAGER | typeof RoleName.STAFF;
}
