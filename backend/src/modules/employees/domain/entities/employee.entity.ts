import { EmployeeStatus } from '@prisma/client';

/** A schedulable staff resource, distinct from `User` login access (docs/WORKFORCE_ARCHITECTURE.md). */
export interface EmployeeEntity {
  id: string;
  tenantId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  status: EmployeeStatus;
  colorTag: string | null;
  bio: string | null;
  createdAt: Date;
  updatedAt: Date;
}
