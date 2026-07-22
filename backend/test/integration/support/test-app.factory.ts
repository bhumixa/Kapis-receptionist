import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoleName } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../../src/app.module';
import { validationExceptionFactory } from '../../../src/common/pipes/validation-exception-factory';
import { PrismaService } from '../../../src/database/prisma.service';
import { PasswordService } from '../../../src/modules/auth/application/password.service';

/**
 * Boots a real Nest application (real Postgres/Redis, the same
 * bootstrap configuration as `main.ts`) for integration tests to drive
 * over HTTP via supertest — deliberately not a running, separately
 * started process (that tier is `test/e2e`), per the test/unit vs
 * test/integration vs test/e2e split (IMPLEMENTATION_ROADMAP.md Section 7.1).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  await app.init();
  return app;
}

export function getPrisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Deletes every row this test run created, in FK-safe order (Users before their Tenant — `onDelete: Restrict`). */
export async function cleanupTenant(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {
    // Already gone (e.g. a test that never got past a failed assertion) — fine.
  });
}

/** A collision-safe email for a single test run (Jest workers + parallel `it`s). */
export function uniqueTestEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@integration-test.example.com`;
}

export interface SeededOwner {
  userId: string;
  tenantId: string;
  email: string;
  password: string;
}

/**
 * Seeds a Tenant + OWNER User directly via Prisma (real Argon2id hash via
 * the real PasswordService), bypassing `POST /auth/register` entirely.
 * Keeps each endpoint's integration spec testing only *that* endpoint's
 * behavior rather than chaining through register's rate limit/behavior as
 * an implicit dependency.
 */
export async function seedOwner(
  app: INestApplication,
  label: string,
): Promise<SeededOwner> {
  const prisma = getPrisma(app);
  const passwordService = app.get(PasswordService);
  const email = uniqueTestEmail(label);
  const password = 'Str0ngP@ss1';

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.OWNER },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: `${label} Salon`,
      slug: `${label}-${Date.now()}`,
      timezone: 'UTC',
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      passwordHash: await passwordService.hash(password),
      firstName: 'Seed',
      lastName: 'Owner',
      roles: { create: { roleId: ownerRole.id } },
    },
  });

  return { userId: user.id, tenantId: tenant.id, email, password };
}
