import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('PUT /api/v1/employees/:id/services (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createEmployee(token: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Ana', lastName: 'Silva' })
      .expect(201);
    return created.body.data.id as string;
  }

  async function createService(token: string, name: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, durationMinutes: 30, priceCents: 1000 })
      .expect(201);
    return created.body.data.id as string;
  }

  it('assigns and replaces eligible services, reflected on both GET /employees/:id and GET /employees?filter[serviceId]', async () => {
    const owner = await seedOwner(app, 'assign-crud');
    try {
      const token = await login(app, owner.email, owner.password);
      const employeeId = await createEmployee(token);
      const serviceA = await createService(token, 'Service A');
      const serviceB = await createService(token, 'Service B');

      const assigned = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ serviceIds: [serviceA, serviceB] })
        .expect(200);
      expect(assigned.body.data.serviceIds.sort()).toEqual(
        [serviceA, serviceB].sort(),
      );

      const employee = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(employee.body.data.serviceIds.sort()).toEqual(
        [serviceA, serviceB].sort(),
      );

      const eligibleFor = await request(app.getHttpServer())
        .get(`/api/v1/employees?serviceId=${serviceA}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(eligibleFor.body.data.map((e: { id: string }) => e.id)).toEqual([
        employeeId,
      ]);

      // Full-replace: dropping serviceB.
      const replaced = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ serviceIds: [serviceA] })
        .expect(200);
      expect(replaced.body.data.serviceIds).toEqual([serviceA]);

      const auditActions = await prisma.auditLog.findMany({
        where: {
          tenantId: owner.tenantId,
          action: 'EMPLOYEE_SERVICES_ASSIGNED',
        },
      });
      expect(auditActions).toHaveLength(2);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a serviceId from another tenant with 422 INVALID_SERVICE_REFERENCE (application-layer guard)', async () => {
    const ownerA = await seedOwner(app, 'assign-cross-a');
    const ownerB = await seedOwner(app, 'assign-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);
      const employeeId = await createEmployee(tokenA);
      const otherTenantServiceId = await createService(tokenB, "B's service");

      const response = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/services`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ serviceIds: [otherTenantServiceId] })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_SERVICE_REFERENCE');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('the compound FK rejects a cross-tenant (employeeId, serviceId) pair at the database level, independent of application validation', async () => {
    const ownerA = await seedOwner(app, 'composite-fk-a');
    const ownerB = await seedOwner(app, 'composite-fk-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);
      const employeeIdA = await createEmployee(tokenA);
      const serviceIdB = await createService(tokenB, "B's service");

      // Bypasses the application layer entirely — a direct Prisma write
      // pairing Tenant A's employee with Tenant B's service, tagged with
      // Tenant A's tenantId (the only way such a row could even be
      // attempted, since EmployeeService.tenantId is a single column).
      // The compound FK (tenantId, serviceId) REFERENCES services(tenantId, id)
      // must reject this, because no row in `services` has
      // (tenantId: ownerA.tenantId, id: serviceIdB) — proving the database
      // itself, not just the service layer, enforces cross-tenant safety
      // (docs/TENANT_ARCHITECTURE.md Section 4.1).
      await expect(
        prisma.employeeService.create({
          data: {
            tenantId: ownerA.tenantId,
            employeeId: employeeIdA,
            serviceId: serviceIdB,
          },
        }),
      ).rejects.toThrow();

      const rows = await prisma.employeeService.findMany({
        where: { employeeId: employeeIdA },
      });
      expect(rows).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });
});
