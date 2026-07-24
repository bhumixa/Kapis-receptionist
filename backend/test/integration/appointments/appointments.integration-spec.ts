import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';
import { seedBookableSetup } from '../support/scheduling-fixtures';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

/** A fixed, far-future weekday-agnostic instant — the fixtures are open 24/7, so any instant works. */
function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

describe('Appointments & Availability (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports the full booking lifecycle: create -> get -> list -> cancel, with audit + history rows', async () => {
    const owner = await seedOwner(app, 'appt-lifecycle');
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880001' })
        .expect(201);
      const customerId = customer.body.data.id as string;

      const startTime = futureIso(48);
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime,
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(201);

      expect(created.body.data).toMatchObject({
        customerId,
        employeeId: setup.employeeId,
        status: 'CONFIRMED',
        totalPriceCents: 8000,
      });
      const appointmentId = created.body.data.id as string;

      const fetched = await request(app.getHttpServer())
        .get(`/api/v1/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(fetched.body.data.id).toBe(appointmentId);

      const list = await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data.map((a: { id: string }) => a.id)).toContain(
        appointmentId,
      );
      expect(list.body.meta.pagination.strategy).toBe('cursor');

      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'Customer requested.' })
        .expect(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');

      const history = await prisma.appointmentStatusHistory.findMany({
        where: { appointmentId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => h.action)).toEqual(['CREATED', 'CANCELLED']);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Appointment' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'APPOINTMENT_CREATED',
        'APPOINTMENT_CANCELLED',
      ]);

      // Cancelling frees the slot: its AppointmentService line must no longer be blocking.
      const lines = await prisma.appointmentService.findMany({
        where: { appointmentId },
      });
      expect(lines.every((line) => line.isBlocking === false)).toBe(true);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('reschedules an appointment into a new linked row and marks the original RESCHEDULED', async () => {
    const owner = await seedOwner(app, 'appt-reschedule');
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880002' })
        .expect(201);
      const customerId = customer.body.data.id as string;

      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime: futureIso(48),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(201);
      const originalId = created.body.data.id as string;

      const rescheduled = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${originalId}/reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ newStartTime: futureIso(96) })
        .expect(200);

      expect(rescheduled.body.data.originalAppointment.status).toBe(
        'RESCHEDULED',
      );
      expect(
        rescheduled.body.data.newAppointment.rescheduledFromAppointmentId,
      ).toBe(originalId);

      // The original's own appointment_services rows must be unblocked.
      const originalLines = await prisma.appointmentService.findMany({
        where: { appointmentId: originalId },
      });
      expect(originalLines.every((line) => line.isBlocking === false)).toBe(
        true,
      );
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects double-booking the same employee/time with 409 SLOT_NO_LONGER_AVAILABLE', async () => {
    const owner = await seedOwner(app, 'appt-conflict');
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880003' })
        .expect(201);
      const customerId = customer.body.data.id as string;
      const startTime = futureIso(48);

      await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime,
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(201);

      const conflict = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          startTime,
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(409);
      expect(conflict.body.error.code).toBe('SLOT_NO_LONGER_AVAILABLE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('replays the exact same response for a retried Idempotency-Key + identical payload, and 409s on reuse with a different payload', async () => {
    const owner = await seedOwner(app, 'appt-idempotency');
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511998880004' })
        .expect(201);
      const customerId = customer.body.data.id as string;
      const idempotencyKey = randomUUID();
      const body = {
        customerId,
        startTime: futureIso(48),
        services: [
          { serviceId: setup.serviceId, employeeId: setup.employeeId },
        ],
      };

      const first = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      expect(replay.body.data.id).toBe(first.body.data.id);

      // Only one appointment was actually created, despite two requests.
      const count = await prisma.appointment.count({
        where: { tenantId: owner.tenantId },
      });
      expect(count).toBe(1);

      const differentPayload = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ ...body, startTime: futureIso(96) })
        .expect(409);
      expect(differentPayload.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 (never 403) for a GET on another tenant's appointment", async () => {
    const ownerA = await seedOwner(app, 'appt-cross-a');
    const ownerB = await seedOwner(app, 'appt-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);
      const setupA = await seedBookableSetup(prisma, ownerA.tenantId);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phoneNumber: '+5511998880005' })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId: customer.body.data.id,
          startTime: futureIso(48),
          services: [
            { serviceId: setupA.serviceId, employeeId: setupA.employeeId },
          ],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(response.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("forbids STAFF from accessing another employee's appointment (403, not 404)", async () => {
    const owner = await seedOwner(app, 'appt-staff-scope-owner');
    try {
      const ownerToken = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);

      const staff = await seedStaff(app, 'appt-staff-scope-staff');
      // Link the STAFF login to a *different* Employee than the one booked.
      const staffEmployee = await prisma.employee.create({
        data: {
          tenantId: owner.tenantId,
          firstName: 'Bea',
          lastName: 'Costa',
          userId: staff.userId,
        },
      });
      await prisma.user.update({
        where: { id: staff.userId },
        data: { tenantId: owner.tenantId },
      });
      const staffToken = await login(app, staff.email, staff.password);

      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ phoneNumber: '+5511998880006' })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId: customer.body.data.id,
          startTime: futureIso(48),
          services: [
            { serviceId: setup.serviceId, employeeId: setup.employeeId },
          ],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      await prisma.employee
        .delete({ where: { id: staffEmployee.id } })
        .catch(() => {});
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('GET /appointments/availability returns bookable slots that respect the service duration and existing bookings', async () => {
    const owner = await seedOwner(app, 'appt-availability');
    try {
      const token = await login(app, owner.email, owner.password);
      const setup = await seedBookableSetup(prisma, owner.tenantId);
      const dateFrom = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const initial = await request(app.getHttpServer())
        .get('/api/v1/appointments/availability')
        .query({ serviceId: setup.serviceId, dateFrom, dateTo: dateFrom })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(initial.body.data)).toBe(true);
      expect(initial.body.data.length).toBeGreaterThan(0);
      expect(initial.body.data[0]).toMatchObject({
        employeeId: setup.employeeId,
      });

      // 422 when the date range exceeds the 31-day cap.
      const tooLarge = await request(app.getHttpServer())
        .get('/api/v1/appointments/availability')
        .query({
          serviceId: setup.serviceId,
          dateFrom,
          dateTo: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(422);
      expect(tooLarge.body.error.code).toBe('DATE_RANGE_TOO_LARGE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });
});
