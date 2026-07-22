import { BusinessHoursEntity } from '../entities/business-hours.entity';

export const BUSINESS_HOURS_REPOSITORY = Symbol('BUSINESS_HOURS_REPOSITORY');

export interface BusinessHoursDayInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isClosed: boolean;
}

export interface BusinessHoursRepositoryPort {
  findAllForTenant(tenantId: string): Promise<BusinessHoursEntity[]>;
  /** Bulk-upserts all 7 days atomically; replaces the full week in one call. */
  replaceAll(
    tenantId: string,
    days: BusinessHoursDayInput[],
  ): Promise<BusinessHoursEntity[]>;
}
