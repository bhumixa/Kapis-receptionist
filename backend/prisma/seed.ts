import { PrismaClient, RoleName } from '@prisma/client';

/**
 * Required seed (PRISMA_SCHEMA.md Section 14.3) — runs in every environment,
 * including production, as part of first deploy. Populates the fixed Role
 * rows, a starter Permission set, the RolePermission matrix, and one default
 * Plan tier.
 *
 * The permission set below covers only what SYSTEM_ARCHITECTURE.md Section
 * 7.4 names explicitly today (billing:manage, account:delete, staff:invite)
 * plus the coarse tenant/settings actions implied by Section 7.3's role
 * descriptions. It is deliberately NOT the full matrix — most permission
 * keys don't exist yet because the modules that would check them (Billing,
 * Employees, Settings, ...) aren't built until later milestones. Each
 * milestone that introduces a guarded action is responsible for adding its
 * permission key(s) here.
 *
 * A separate, dev-only seed for sample tenant/employee/customer data is
 * deferred until those modules exist (Milestone 4+) — there is nothing
 * meaningful to seed for them yet.
 */

const prisma = new PrismaClient();

const PERMISSIONS = [
  {
    key: 'billing:manage',
    description: 'Manage subscription and payment methods',
  },
  { key: 'account:delete', description: 'Delete the tenant account' },
  { key: 'staff:invite', description: 'Invite new staff members' },
  { key: 'tenant:manage', description: 'Manage tenant-wide settings' },
  {
    key: 'settings:manage',
    description: 'Manage salon configuration and preferences',
  },
  {
    key: 'salon:manage',
    description: 'Manage salon profile, branding, business hours, and holidays',
  },
] as const;

const ROLE_PERMISSIONS: Record<RoleName, readonly string[]> = {
  [RoleName.SUPER_ADMIN]: PERMISSIONS.map((p) => p.key),
  [RoleName.OWNER]: PERMISSIONS.map((p) => p.key),
  [RoleName.MANAGER]: [
    'staff:invite',
    'tenant:manage',
    'settings:manage',
    'salon:manage',
  ],
  [RoleName.STAFF]: [],
};

const ROLES: Array<{ name: RoleName; description: string }> = [
  {
    name: RoleName.SUPER_ADMIN,
    description: 'Platform-wide administrator, no tenant scope',
  },
  { name: RoleName.OWNER, description: 'Full control over their tenant' },
  {
    name: RoleName.MANAGER,
    description: 'Near-owner, excluding billing and account deletion',
  },
  {
    name: RoleName.STAFF,
    description: 'Scoped to their own calendar and conversation handoffs',
  },
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: roleName as RoleName },
    });

    for (const key of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key },
      });
      await prisma.rolePermission.upsert({
        where: {
          uq_role_permissions_role_permission: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  await prisma.plan.upsert({
    where: { stripePriceId: 'price_placeholder_starter' },
    update: {},
    create: {
      name: 'Starter',
      stripePriceId: 'price_placeholder_starter',
      monthlyPriceCents: 4900,
      currency: 'USD',
      maxStaff: 5,
      maxMessagesPerMonth: 1000,
      maxLocations: 1,
      isActive: true,
      trialDays: 14,
    },
  });

  console.log(
    'Seed complete: roles, permissions, role-permissions, and the default plan.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
