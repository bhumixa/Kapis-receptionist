import { HolidayEntity } from '../entities/holiday.entity';

export const HOLIDAY_REPOSITORY = Symbol('HOLIDAY_REPOSITORY');

export interface CreateHolidayInput {
  date: string;
  reason: string;
}

export interface UpdateHolidayInput {
  date?: string;
  reason?: string;
}

export interface HolidayRepositoryPort {
  findAllForTenant(tenantId: string): Promise<HolidayEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<HolidayEntity | null>;
  findByDateForTenant(
    tenantId: string,
    date: string,
  ): Promise<HolidayEntity | null>;
  create(tenantId: string, input: CreateHolidayInput): Promise<HolidayEntity>;
  update(
    tenantId: string,
    id: string,
    input: UpdateHolidayInput,
  ): Promise<HolidayEntity>;
  /** Hard delete — a low-stakes leaf entity; the audit log preserves the trail. */
  delete(tenantId: string, id: string): Promise<void>;
}
