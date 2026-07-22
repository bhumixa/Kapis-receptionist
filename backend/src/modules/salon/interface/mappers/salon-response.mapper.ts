import { SalonProfileView } from '../../application/salon-profile.service';
import { BusinessHoursEntity } from '../../domain/entities/business-hours.entity';
import { HolidayEntity } from '../../domain/entities/holiday.entity';
import { BusinessHoursResponseDto } from '../dto/business-hours-response.dto';
import { HolidayResponseDto } from '../dto/holiday-response.dto';
import { SalonProfileResponseDto } from '../dto/salon-profile-response.dto';

export function toSalonProfileResponseDto(
  view: SalonProfileView,
): SalonProfileResponseDto {
  return {
    name: view.name,
    addressLine1: view.addressLine1,
    addressLine2: view.addressLine2,
    city: view.city,
    countryCode: view.countryCode,
    timezone: view.timezone,
    defaultLocale: view.defaultLocale,
    description: view.description,
    contactEmail: view.contactEmail,
    contactPhone: view.contactPhone,
    website: view.website,
    currency: view.currency,
    logoUrl: view.logoUrl,
    primaryColor: view.primaryColor,
    secondaryColor: view.secondaryColor,
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function toBusinessHoursResponseDto(
  entity: BusinessHoursEntity,
): BusinessHoursResponseDto {
  return {
    dayOfWeek: entity.dayOfWeek,
    startTime: entity.startTime,
    endTime: entity.endTime,
    isClosed: entity.isClosed,
  };
}

export function toHolidayResponseDto(
  entity: HolidayEntity,
): HolidayResponseDto {
  return {
    id: entity.id,
    date: entity.date,
    reason: entity.reason,
    createdAt: entity.createdAt.toISOString(),
  };
}
