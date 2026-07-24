import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  cleanupTenant,
  createTestApp,
  getPrisma,
  seedOwner,
  seedManager,
  seedStaff,
} from '../support/test-app.factory';

async function login(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.accessToken as string;
}

describe('GET/POST/PATCH/DELETE /api/v1/customers (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports the full CRUD lifecycle and records an audit entry for each mutation', async () => {
    const owner = await seedOwner(app, 'cust-crud');
    try {
      const token = await login(app, owner.email, owner.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          phoneNumber: '+5511999990001',
          firstName: 'Sofia',
          lastName: 'Reyes',
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        phoneNumber: '+5511999990001',
        firstName: 'Sofia',
      });
      const customerId = created.body.data.id as string;

      const fetched = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(fetched.body.data.id).toBe(customerId);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lastName: 'Reyes-Costa' })
        .expect(200);
      expect(updated.body.data.lastName).toBe('Reyes-Costa');

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const auditActions = await prisma.auditLog.findMany({
        where: { tenantId: owner.tenantId, entityType: 'Customer' },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditActions.map((a) => a.action)).toEqual([
        'CUSTOMER_CREATED',
        'CUSTOMER_UPDATED',
        'CUSTOMER_DELETED',
      ]);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('rejects a duplicate phone number within the same tenant with 409 PHONE_NUMBER_ALREADY_EXISTS', async () => {
    const owner = await seedOwner(app, 'cust-dup-phone');
    try {
      const token = await login(app, owner.email, owner.password);

      const first = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511999990002' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+5511999990002' })
        .expect(409);

      expect(second.body.error.code).toBe('PHONE_NUMBER_ALREADY_EXISTS');
      expect(second.body.error.details[0].customerId).toBe(first.body.data.id);
    } finally {
      await cleanupTenant(prisma, owner.tenantId);
    }
  });

  it('allows the same phone number to be reused across two different tenants', async () => {
    const ownerA = await seedOwner(app, 'cust-cross-phone-a');
    const ownerB = await seedOwner(app, 'cust-cross-phone-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phoneNumber: '+5511999990003' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ phoneNumber: '+5511999990003' })
        .expect(201);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("returns 404 (never 403) for a GET/PATCH on another tenant's customer", async () => {
    const ownerA = await seedOwner(app, 'cust-cross-a');
    const ownerB = await seedOwner(app, 'cust-cross-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phoneNumber: '+5511999990004' })
        .expect(201);
      const customerId = created.body.data.id as string;

      const getResponse = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(getResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');

      const patchResponse = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'Hacked' })
        .expect(404);
      expect(patchResponse.body.error.code).toBe('TENANT_RESOURCE_NOT_FOUND');
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it("Tenant A's customer list never includes Tenant B's customers", async () => {
    const ownerA = await seedOwner(app, 'cust-iso-a');
    const ownerB = await seedOwner(app, 'cust-iso-b');
    try {
      const tokenA = await login(app, ownerA.email, ownerA.password);
      const tokenB = await login(app, ownerB.email, ownerB.password);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phoneNumber: '+5511999990005' })
        .expect(201);

      const bList = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(bList.body.data).toEqual([]);
    } finally {
      await cleanupTenant(prisma, ownerA.tenantId);
      await cleanupTenant(prisma, ownerB.tenantId);
    }
  });

  it('STAFF can create/update customers but not delete them', async () => {
    const staff = await seedStaff(app, 'cust-rbac-staff');
    try {
      const staffToken = await login(app, staff.email, staff.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ phoneNumber: '+5511999990006' })
        .expect(201);
      const customerId = created.body.data.id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ firstName: 'Updated' })
        .expect(200);

      const staffDelete = await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
      expect(staffDelete.body.error.code).toBe('INSUFFICIENT_ROLE');
    } finally {
      await cleanupTenant(prisma, staff.tenantId);
    }
  });

  it('MANAGER can delete a customer', async () => {
    const manager = await seedManager(app, 'cust-rbac-manager');
    try {
      const managerToken = await login(app, manager.email, manager.password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ phoneNumber: '+5511999990007' })
        .expect(201);
      const customerId = created.body.data.id as string;

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
    } finally {
      await cleanupTenant(prisma, manager.tenantId);
    }
  });
});
