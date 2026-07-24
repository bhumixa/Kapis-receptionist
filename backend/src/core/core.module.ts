import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { AuditLogModule } from './audit/audit-log.module';
import { TenantContextService } from './context/tenant-context.service';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { SuperAdminBypassService } from './guards/super-admin-bypass.service';
import { TenantActiveGuard } from './guards/tenant-active.guard';
import { TenantScopedGuard } from './guards/tenant-scoped.guard';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { PermissionResolverService } from './permission-resolver.service';
import { EncryptionModule } from './security/encryption.module';

/**
 * Cross-cutting authorization infrastructure (docs/adr/ADR-005-rbac.md,
 * docs/adr/ADR-006, SYSTEM_ARCHITECTURE.md Section 3.2 "Core"). Imports
 * `AuthModule` for `SecurityEventService` (bypass-usage logging).
 * `PrismaService`/`RedisService` need no explicit import — `DatabaseModule`
 * is `@Global()`. `AuditLogModule` is imported directly (not via `AuthModule`)
 * since it has no dependency on Auth at all.
 *
 * `forwardRef(() => AuthModule)`: as of Milestone 3, `AuthModule` also
 * imports `CoreModule` (for `TenantContextService`, so `/auth/me` and
 * `/auth/accept-invitation` can resolve the effective/impersonated tenant
 * the same way every other module does — docs/adr/ADR-006). That makes this
 * a genuine, intentional circular module dependency, not an accident;
 * `forwardRef` on both sides is the standard Nest resolution for it.
 *
 * Not `@Global()`: consuming modules import both `AuthModule` (for
 * `JwtAuthGuard`) and `CoreModule` explicitly, matching the existing
 * non-global export pattern already used elsewhere in this codebase.
 */
@Module({
  imports: [forwardRef(() => AuthModule), AuditLogModule, EncryptionModule],
  providers: [
    TenantContextService,
    PermissionResolverService,
    SuperAdminBypassService,
    RolesGuard,
    PermissionGuard,
    TenantScopedGuard,
    TenantActiveGuard,
    SuperAdminGuard,
    TenantMiddleware,
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
    TenantActiveGuard,
    SuperAdminGuard,
    TenantMiddleware,
    AuditLogModule,
    EncryptionModule,
  ],
})
export class CoreModule {}
