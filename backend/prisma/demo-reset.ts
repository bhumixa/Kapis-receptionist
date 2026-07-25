import { PrismaClient } from '@prisma/client';
import { DEMO_TENANT_SLUG } from './demo-constants';

/**
 * Removes everything `demo-seed.ts` created, and nothing else.
 *
 * Safe by construction: it only ever touches the one tenant identified by
 * `DEMO_TENANT_SLUG`, never a real customer tenant. Global reference data
 * shared with the required seed (Role/Permission/Plan) and the
 * `PromptVersion` registry are left untouched — they're not demo-specific.
 *
 * Deletes explicitly in dependency order rather than relying on `Tenant`'s
 * cascading FKs: several tenant-scoped tables (AppointmentService/
 * Appointment -> Employee/Customer, Conversation -> Customer/WhatsAppAccount)
 * use `onDelete: Restrict` composite FKs alongside Tenant's own `onDelete:
 * Cascade` FK to the same rows — a "diamond" dependency Postgres does not
 * reliably resolve in a single cascading `DELETE FROM tenants`, as
 * confirmed by hitting `appointment_services_tenantId_employeeId_fkey`
 * (RESTRICT) here when a straight `tenant.delete()` was tried. Deleting
 * children before parents sidesteps that entirely. Users are deleted last
 * before Tenant (User.tenant is onDelete: Restrict, not Cascade).
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
  });

  if (!tenant) {
    console.log(
      `No demo tenant found (slug "${DEMO_TENANT_SLUG}") — nothing to reset.`,
    );
    return;
  }

  const tenantId = tenant.id;
  console.log(`Removing demo tenant "${tenant.name}" (${tenantId})...`);

  await prisma.appointmentService.deleteMany({ where: { tenantId } });
  await prisma.appointmentStatusHistory.deleteMany({ where: { tenantId } });
  await prisma.appointment.deleteMany({ where: { tenantId } });

  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversationSummary.deleteMany({ where: { tenantId } });
  await prisma.aIContext.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.whatsAppAccount.deleteMany({ where: { tenantId } });

  await prisma.employeeService.deleteMany({ where: { tenantId } });
  await prisma.workingHours.deleteMany({ where: { tenantId } });
  await prisma.employeeTimeOff.deleteMany({ where: { tenantId } });
  await prisma.employee.deleteMany({ where: { tenantId } });

  await prisma.service.deleteMany({ where: { tenantId } });
  await prisma.serviceCategory.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });

  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.invoice.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });

  await prisma.salonProfile.deleteMany({ where: { tenantId } });
  await prisma.businessHours.deleteMany({ where: { tenantId } });
  await prisma.holiday.deleteMany({ where: { tenantId } });
  await prisma.tenantSettings.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });

  const { count: userCount } = await prisma.user.deleteMany({
    where: { tenantId },
  });
  await prisma.tenant.delete({ where: { id: tenantId } });

  console.log(
    `Removed ${userCount} user(s) and the tenant, plus all demo salon, staff,`,
  );
  console.log(
    'service, customer, appointment, WhatsApp, billing, and audit data.',
  );
  console.log('Demo reset complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Demo reset failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
