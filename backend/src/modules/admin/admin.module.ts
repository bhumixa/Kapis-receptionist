import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdminBillingController } from './interface/admin-billing.controller';
import { AdminTenantsController } from './interface/admin-tenants.controller';

/**
 * Milestone 3's narrow Admin slice (docs/adr/ADR-006, API_SPECIFICATION.md
 * Section 16) — tenant list + lifecycle actions — plus Milestone 9's
 * billing oversight (`AdminBillingController`: plan management, per-tenant
 * subscription/invoice lookup). `GET /admin/users` and `GET /admin/system`
 * remain unbuilt (still no dedicated `Users` module / platform system
 * metrics surface). No `forwardRef` needed: `TenantsModule`/`AuthModule`/
 * `BillingModule` don't depend on `AdminModule` (SYSTEM_ARCHITECTURE.md
 * Section 3.3 — "no module depends on `Admin`, keeping Super Admin
 * capability strictly additive").
 */
@Module({
  imports: [AuthModule, TenantsModule, BillingModule],
  controllers: [AdminTenantsController, AdminBillingController],
})
export class AdminModule {}
