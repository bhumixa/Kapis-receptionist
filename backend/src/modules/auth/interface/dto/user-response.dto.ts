import { RoleName } from '@prisma/client';

/** API_SPECIFICATION.md Section 3 `UserDTO` — never includes `passwordHash`. */
export interface UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: RoleName[];
  isActive: boolean;
  isEmailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
