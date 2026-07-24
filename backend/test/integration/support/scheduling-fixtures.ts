import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../../src/database/prisma.service';

/**
 * Seeds a minimal, always-open bookable setup (salon open every day
 * 00:00-23:59, one ACTIVE employee working every day 00:00-23:59, one
 * service, and the employee<->service eligibility link) directly via
 * Prisma — the prerequisite data for `modules/appointments`/`modules/
 * availability` integration tests, deliberately bypassing every prior
 * milestone's own HTTP endpoints (the same precedent `seedOwner` already
 * set for `User`) so each spec only chains through what it's actually
 * testing. "Always open" avoids any day-of-week arithmetic in the tests
 * themselves — any future date/time picked by a test falls within an open
 * window.
 */
export interface BookableSetup {
  employeeId: string;
  serviceId: string;
  durationMinutes: number;
  bufferTimeMinutes: number;
}

export async function seedBookableSetup(
  prisma: PrismaService,
  tenantId: string,
  overrides: { durationMinutes?: number; bufferTimeMinutes?: number } = {},
): Promise<BookableSetup> {
  const durationMinutes = overrides.durationMinutes ?? 45;
  const bufferTimeMinutes = overrides.bufferTimeMinutes ?? 10;

  await prisma.businessHours.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      tenantId,
      dayOfWeek,
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      endTime: new Date('1970-01-01T23:59:00.000Z'),
      isClosed: false,
    })),
  });

  const employee = await prisma.employee.create({
    data: {
      tenantId,
      firstName: 'Ana',
      lastName: 'Silva',
      status: EmployeeStatus.ACTIVE,
    },
  });

  await prisma.workingHours.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      tenantId,
      employeeId: employee.id,
      dayOfWeek,
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      endTime: new Date('1970-01-01T23:59:00.000Z'),
      isActive: true,
    })),
  });

  const service = await prisma.service.create({
    data: {
      tenantId,
      name: 'Haircut',
      durationMinutes,
      priceCents: 8000,
      currency: 'USD',
      bufferTimeMinutes,
    },
  });

  await prisma.employeeService.create({
    data: { tenantId, employeeId: employee.id, serviceId: service.id },
  });

  return {
    employeeId: employee.id,
    serviceId: service.id,
    durationMinutes,
    bufferTimeMinutes,
  };
}
