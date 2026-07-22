import { RoleName } from '@prisma/client';

export interface InvitationResponseDto {
  id: string;
  email: string;
  role: RoleName;
  expiresAt: string;
  createdAt: string;
}
