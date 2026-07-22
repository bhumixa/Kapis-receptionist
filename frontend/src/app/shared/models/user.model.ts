/** Mirrors docs/API_SPECIFICATION.md Section 3 `UserDTO`. */
export type RoleName = 'SUPER_ADMIN' | 'OWNER' | 'MANAGER' | 'STAFF';

export interface User {
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
