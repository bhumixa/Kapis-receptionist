import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { TenantContextService } from './context/tenant-context.service';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { SuperAdminBypassService } from './guards/super-admin-bypass.service';
import { TenantScopedGuard } from './guards/tenant-scoped.guard';
import { PermissionResolverService } from './permission-resolver.service';

/**
 * Cross-cutting authorization infrastructure (docs/adr/ADR-005-rbac.md,
 * SYSTEM_ARCHITECTURE.md Section 3.2 "Core"). Imports `AuthModule` for
 * `SecurityEventService` (bypass-usage logging). `PrismaService`/
 * `RedisService` need no explicit import — `DatabaseModule` is `@Global()`.
 *
 * Not `@Global()`: consuming modules import both `AuthModule` (for
 * `JwtAuthGuard`) and `CoreModule` explicitly, matching the existing
 * non-global export pattern already used elsewhere in this codebase.
 */
@Module({
  imports: [AuthModule],
  providers: [
    TenantContextService,
    PermissionResolverService,
    SuperAdminBypassService,
    RolesGuard,
    PermissionGuard,
    TenantScopedGuard,
    SuperAdminGuard,
  ],
  // SuperAdminBypassService is exported alongside the guards that depend on
  // it (RolesGuard/PermissionGuard) — a guard used via `@UseGuards()` in a
  // module other than the one that declares it needs its own dependencies
  // resolvable from that host module too, not just the guard class itself.
  exports: [
    TenantContextService,
    PermissionResolverService,
    SuperAdminBypassService,
    RolesGuard,
    PermissionGuard,
    TenantScopedGuard,
    SuperAdminGuard,
  ],
})
export class CoreModule {}
