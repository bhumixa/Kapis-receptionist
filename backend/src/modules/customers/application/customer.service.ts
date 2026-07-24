import { Inject, Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { CustomerEntity } from '../domain/entities/customer.entity';
import {
  CUSTOMER_REPOSITORY,
  type CreateCustomerInput,
  type CustomerListFilter,
  type CustomerRepositoryPort,
  type UpdateCustomerInput,
} from '../domain/ports/customer-repository.port';
import {
  NoUpdateFieldsProvidedException,
  PhoneNumberAlreadyExistsException,
} from './exceptions/customer.exceptions';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * `GET/POST/PATCH/DELETE /customers[/:id]` (API_SPECIFICATION.md Section 9).
 * Also this module's public surface, consumed by `modules/appointments`
 * (`findByIdsForTenant`) to validate a `customerId` without that module
 * reaching into this module's Prisma model directly (module-boundary rule,
 * SYSTEM_ARCHITECTURE.md Section 2.3 — same one-directional-dependency
 * pattern ADR-008 established for `Employees -> Services`).
 */
@Injectable()
export class CustomerService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listCustomers(
    tenantId: string,
    filter: CustomerListFilter,
  ): Promise<CustomerEntity[]> {
    return this.customers.findList(tenantId, filter);
  }

  async getCustomer(tenantId: string, id: string): Promise<CustomerEntity> {
    const customer = await this.customers.findByIdForTenant(tenantId, id);
    if (!customer) {
      throw new TenantResourceNotFoundException();
    }
    return customer;
  }

  /** Validates every id belongs to the tenant. Used by `modules/appointments`. */
  async findByIdsForTenant(
    tenantId: string,
    ids: string[],
  ): Promise<CustomerEntity[]> {
    return this.customers.findByIdsForTenant(tenantId, ids);
  }

  async createCustomer(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateCustomerInput,
  ): Promise<CustomerEntity> {
    const existing = await this.customers.findByPhoneForTenant(
      tenantId,
      input.phoneNumber,
    );
    if (existing) {
      throw new PhoneNumberAlreadyExistsException(existing.id);
    }

    let customer: CustomerEntity;
    try {
      customer = await this.customers.create(tenantId, input);
    } catch (error) {
      // Race-condition safety net: two concurrent creates for the same
      // phone number both pass the pre-check above, but the partial unique
      // index (docs/PRISMA_SCHEMA.md Section 14.4) still blocks the second
      // write at the database level.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        const conflicting = await this.customers.findByPhoneForTenant(
          tenantId,
          input.phoneNumber,
        );
        throw new PhoneNumberAlreadyExistsException(conflicting?.id ?? '');
      }
      throw error;
    }

    await this.auditLog.record({
      action: 'CUSTOMER_CREATED',
      entityType: 'Customer',
      entityId: customer.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { phoneNumber: customer.phoneNumber },
    });

    return customer;
  }

  async updateCustomer(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    input: UpdateCustomerInput,
  ): Promise<CustomerEntity> {
    if (Object.keys(input).length === 0) {
      throw new NoUpdateFieldsProvidedException();
    }

    const current = await this.customers.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    const updated = await this.customers.update(tenantId, id, input);

    await this.auditLog.record({
      action: 'CUSTOMER_UPDATED',
      entityType: 'Customer',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async deleteCustomer(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.customers.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.customers.softDelete(tenantId, id);

    await this.auditLog.record({
      action: 'CUSTOMER_DELETED',
      entityType: 'Customer',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { phoneNumber: current.phoneNumber },
    });
  }
}
