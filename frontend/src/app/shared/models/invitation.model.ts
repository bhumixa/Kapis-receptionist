import { RoleName } from './user.model';

/** Mirrors `backend/src/modules/tenants/interface/dto/invitation-response.dto.ts`. */
export interface Invitation {
  id: string;
  email: string;
  role: RoleName;
  expiresAt: string;
  createdAt: string;
}
