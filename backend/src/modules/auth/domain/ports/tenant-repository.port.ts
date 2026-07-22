import { AuthTenant } from '../entities/auth-tenant.entity';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface TenantRepositoryPort {
  findById(id: string): Promise<AuthTenant | null>;
}
