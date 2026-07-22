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

describe('GET/POST/DELETE /api/v1/employees/:id/time-off (integration)', () => {
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

  it('supports create/list/delete and records an audit entry for each mutation', async () => {
    const owner = await seedOwner(app, 'timeoff-crud');
    try {
      const token = await login(app, owner.email, owner.password);
      const employeeId = await createEmployee(token);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/employees/${employeeId}/time-off`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startDate: '2026-08-01',
          endDate: '2026-08-07',
          reason: 'Annual leave',
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        startDate: '2026-08-01',
        endDate: '2026-08-07',
        reason: 'Annual leave',
      });
      const timeOffId = created.body.data.id as string;

      const list = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}/time-off`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toHaveLength(1);

      await request(app.getHttpServer())
        .delete(`/api/v1/employees/${employeeId}/time-off/${timeOffId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const afterDelete = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}/time-off`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterDelete.body.data).toEqual([]);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Employee' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'EMPLOYEE_CREATED',
        'EMPLOYEE_TIME_OFF_CREATED',
        'EMPLOYEE_TIME_OFF_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects endDate before startDate with 422 INVALID_TIME_OFF_RANGE', async () => {
    const owner = await seedOwner(app, 'timeoff-invalid');
    try {
      const token = await login(app, owner.email, owner.password);
      const employeeId = await createEmployee(token);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/employees/${employeeId}/time-off`)
        .set('Authorization', `Bearer ${token}`)
        .send({ startDate: '2026-08-10', endDate: '2026-08-01' })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_TIME_OFF_RANGE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 (never 403) for a DELETE on another tenant's time off", async () => {
    const ownerA = await seedOwner(app, 'timeoff-cross-a');
    const ownerB = await seedOwner(app, 'timeoff-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);
      const employeeId = await createEmployee(tokenA);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/employees/${employeeId}/time-off`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ startDate: '2026-08-01', endDate: '2026-08-07' })
        .expect(201);
      const timeOffId = created.body.data.id as string;

      // Tenant B doesn't even own the employeeId, so the employee lookup itself 404s.
      const response = await request(app.getHttpServer())
        .delete(`/api/v1/employees/${employeeId}/time-off/${timeOffId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(response.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });
});
