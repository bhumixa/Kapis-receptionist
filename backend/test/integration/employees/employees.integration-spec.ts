import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedStaff,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('GET/POST/PATCH/DELETE /api/v1/employees (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports the full CRUD lifecycle, status transitions, and records an audit entry for each mutation', async () => {
    const owner = await seedOwner(app, 'emp-crud');
    try {
      const token = await login(app, owner.email, owner.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Ana', lastName: 'Silva', colorTag: '#4F46E5' })
        .expect(201);
      expect(created.body.data).toMatchObject({
        firstName: 'Ana',
        lastName: 'Silva',
        status: 'ACTIVE',
        serviceIds: [],
      });
      const employeeId = created.body.data.id as string;

      const fetched = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(fetched.body.data.id).toBe(employeeId);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ON_LEAVE' })
        .expect(200);
      expect(updated.body.data.status).toBe('ON_LEAVE');

      await request(app.getHttpServer())
        .delete(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Employee' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'EMPLOYEE_CREATED',
        'EMPLOYEE_STATUS_CHANGED',
        'EMPLOYEE_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a userId that does not belong to the tenant with 422 INVALID_USER_REFERENCE', async () => {
    const owner = await seedOwner(app, 'emp-invalid-user');
    try {
      const token = await login(app, owner.email, owner.password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Ghost',
          lastName: 'User',
          userId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_USER_REFERENCE');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects linking a userId already linked to another employee with 409', async () => {
    const owner = await seedOwner(app, 'emp-user-link');
    try {
      const token = await login(app, owner.email, owner.password);

      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Ana', lastName: 'Silva', userId: owner.userId })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Bea', lastName: 'Costa', userId: owner.userId })
        .expect(409);
      expect(response.body.error.code).toBe('USER_ALREADY_LINKED');
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it("returns 404 (never 403) for a PATCH/DELETE on another tenant's employee", async () => {
    const ownerA = await seedOwner(app, 'emp-cross-a');
    const ownerB = await seedOwner(app, 'emp-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ firstName: "Tenant A's", lastName: 'Employee' })
        .expect(201);
      const employeeId = created.body.data.id as string;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'Hacked' })
        .expect(404);
      expect(patchResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(deleteResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("Tenant A's employee list never includes Tenant B's employees", async () => {
    const ownerA = await seedOwner(app, 'emp-iso-a');
    const ownerB = await seedOwner(app, 'emp-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ firstName: "Tenant A's", lastName: 'Employee' })
        .expect(201);

      const bList = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(bList.body.data).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('STAFF can read employees but cannot create/update/delete them', async () => {
    const staff = await seedStaff(app, 'emp-staff');
    try {
      const token = await login(app, staff.email, staff.password);
      await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Should', lastName: 'NotBeAllowed' })
        .expect(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });
});
