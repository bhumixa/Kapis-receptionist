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

describe('GET/PUT /api/v1/employees/:id/working-hours (integration)', () => {
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

  it('replaces the full working-hours set, allows split shifts, and records an audit entry', async () => {
    const owner = await seedOwner(app, 'wh-crud');
    try {
      const token = await login(app, owner.email, owner.password);
      const employeeId = await createEmployee(token);

      const empty = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}/working-hours`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(empty.body.data).toEqual([]);

      const entries = [
        { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', isActive: true },
        { dayOfWeek: 1, startTime: '13:00', endTime: '17:00', isActive: true },
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
      ];
      const replaced = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/working-hours`)
        .set('Authorization', `Bearer ${token}`)
        .send({ entries })
        .expect(200);
      expect(replaced.body.data).toHaveLength(3);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}/working-hours`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toHaveLength(3);

      const auditActions = await prisma.auditLog.findMany({
        where: {
          tenantId: owner.tenantId,
          entityType: 'Employee',
          action: 'EMPLOYEE_WORKING_HOURS_UPDATED',
        },
      });
      expect(auditActions).toHaveLength(1);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects endTime <= startTime with 422 INVALID_WORKING_HOURS_ENTRY', async () => {
    const owner = await seedOwner(app, 'wh-invalid');
    try {
      const token = await login(app, owner.email, owner.password);
      const employeeId = await createEmployee(token);

      const response = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/working-hours`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          entries: [
            {
              dayOfWeek: 1,
              startTime: '17:00',
              endTime: '09:00',
              isActive: true,
            },
          ],
        })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_WORKING_HOURS_ENTRY');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 for another tenant's employee id", async () => {
    const ownerA = await seedOwner(app, 'wh-cross-a');
    const ownerB = await seedOwner(app, 'wh-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);
      const employeeId = await createEmployee(tokenA);

      const response = await request(app.getHttpServer())
        .put(`/api/v1/employees/${employeeId}/working-hours`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          entries: [
            {
              dayOfWeek: 1,
              startTime: '09:00',
              endTime: '17:00',
              isActive: true,
            },
          ],
        })
        .expect(404);
      expect(response.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });
});
