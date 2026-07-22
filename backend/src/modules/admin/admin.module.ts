import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdminTenantsController } from './interface/admin-tenants.controller';

/**
 * Milestone 3's narrow Admin slice (docs/adr/ADR-006, API_SPECIFICATION.md
 * Section 16) — tenant list + lifecycle actions only. `GET /admin/users`
 * and `GET /admin/system` are explicit Milestone 9 scope, not built here.
 * No `forwardRef` needed: `TenantsModule`/`AuthModule` don't depend on
 * `AdminModule` (SYSTEM_ARCHITECTURE.md Section 3.3 — "no module depends on
 * `Admin`, keeping Super Admin capability strictly additive").
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [AdminTenantsController],
})
export class AdminModule {}
