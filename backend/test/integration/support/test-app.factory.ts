import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoleName } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../../src/app.module';
import { validationExceptionFactory } from '../../../src/common/pipes/validation-exception-factory';
import { PrismaService } from '../../../src/database/prisma.service';
import { PasswordService } from '../../../src/modules/auth/application/password.service';
import { RbacProbeTestModule } from './rbac-probe/rbac-probe.module';

/**
 * Boots a real Nest application (real Postgres/Redis, the same
 * bootstrap configuration as `main.ts`) for integration tests to drive
 * over HTTP via supertest — deliberately not a running, separately
 * started process (that tier is `test/e2e`), per the test/unit vs
 * test/integration vs test/e2e split (IMPLEMENTATION_ROADMAP.md Section 7.1).
 *
 * `RbacProbeTestModule` (docs/adr/ADR-005-rbac.md) is mounted here only —
 * never in `src/app.module.ts` — so the RBAC guards can be proven over real
 * HTTP without a throwaway production route.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, RbacProbeTestModule],
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

/** Deletes a tenant-less seeded user (e.g. `seedSuperAdmin`) — no `Tenant` row to clean up. */
export async function cleanupUser(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
    // Already gone — fine.
  });
}

/** A collision-safe email for a single test run (Jest workers + parallel `it`s). */
export function uniqueTestEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@integration-test.example.com`;
}

export interface SeededUser {
  userId: string;
  /** `null` only for a `seedSuperAdmin`-seeded user — mirrors `AccessTokenPayload.tenantId`. */
  tenantId: string | null;
  email: string;
  password: string;
}

export type SeededOwner = SeededUser & { tenantId: string };

/**
 * Seeds a User with the given role directly via Prisma (real Argon2id hash
 * via the real `PasswordService`), bypassing `POST /auth/register`
 * entirely. Keeps each endpoint's integration spec testing only *that*
 * endpoint's behavior rather than chaining through register's rate
 * limit/behavior as an implicit dependency. Internal helper backing
 * `seedOwner`/`seedManager`/`seedStaff`/`seedSuperAdmin` (docs/adr/
 * ADR-005-rbac.md) — one implementation instead of four near-duplicates.
 */
async function seedUserWithRole(
  app: INestApplication,
  label: string,
  roleName: RoleName,
  { withTenant = true }: { withTenant?: boolean } = {},
): Promise<SeededUser> {
  const prisma = getPrisma(app);
  const passwordService = app.get(PasswordService);
  const email = uniqueTestEmail(label);
  const password = 'Str0ngP@ss1';

  const role = await prisma.role.findUniqueOrThrow({
    where: { name: roleName },
  });

  const tenantId = withTenant
    ? (
        await prisma.tenant.create({
          data: {
            name: `${label} Salon`,
            slug: `${label}-${Date.now()}`,
            timezone: 'UTC',
          },
        })
      ).id
    : null;

  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await passwordService.hash(password),
      firstName: 'Seed',
      lastName: roleName,
      // This helper bypasses `POST /auth/register` entirely (see doc
      // comment above) specifically so other endpoints' specs (login,
      // logout, refresh, me) don't implicitly depend on register's
      // behavior — that includes email verification, so the seeded user
      // is created pre-verified.
      isEmailVerified: true,
      roles: { create: { roleId: role.id } },
    },
  });

  return { userId: user.id, tenantId, email, password };
}

export async function seedOwner(
  app: INestApplication,
  label: string,
): Promise<SeededOwner> {
  return (await seedUserWithRole(app, label, RoleName.OWNER)) as SeededOwner;
}

export async function seedManager(
  app: INestApplication,
  label: string,
): Promise<SeededOwner> {
  return (await seedUserWithRole(app, label, RoleName.MANAGER)) as SeededOwner;
}

export async function seedStaff(
  app: INestApplication,
  label: string,
): Promise<SeededOwner> {
  return (await seedUserWithRole(app, label, RoleName.STAFF)) as SeededOwner;
}

/** No `Tenant` is created — `tenantId: null` on the User row, matching `AccessTokenPayload.tenantId` for `SUPER_ADMIN`. */
export async function seedSuperAdmin(
  app: INestApplication,
  label: string,
): Promise<SeededUser> {
  return seedUserWithRole(app, label, RoleName.SUPER_ADMIN, {
    withTenant: false,
  });
}
