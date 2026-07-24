/**
 * A salon's end customer (Milestone 6, docs/adr/ADR-009-scheduling-engine.md)
 * — scoped down from PRISMA_SCHEMA.md's full Customer domain: no
 * CustomerTag/CustomerNote/CustomerPreference this milestone (not requested
 * — only "Customer CRUD" was asked for), same "narrow the ask, log the
 * deferral" precedent ADR-008 already set.
 */
export interface CustomerEntity {
  id: string;
  tenantId: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  preferredLanguage: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}
