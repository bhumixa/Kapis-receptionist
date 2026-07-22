import { forwardRef, Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TENANT_REPOSITORY } from './domain/ports/tenant-repository.port';
import { TENANT_SETTINGS_REPOSITORY } from './domain/ports/tenant-settings-repository.port';
import { TENANT_INVITATION_REPOSITORY } from './domain/ports/tenant-invitation-repository.port';
import { TenantService } from './application/tenant.service';
import { TenantSettingsService } from './application/tenant-settings.service';
import { TenantLifecycleService } from './application/tenant-lifecycle.service';
import { TenantInvitationService } from './application/tenant-invitation.service';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';
import { PrismaTenantSettingsRepository } from './infrastructure/prisma-tenant-settings.repository';
import { PrismaTenantInvitationRepository } from './infrastructure/prisma-tenant-invitation.repository';
import { TenantController } from './interface/tenant.controller';
import { TenantSettingsController } from './interface/tenant-settings.controller';
import { TenantInvitationsController } from './interface/tenant-invitations.controller';

/**
 * Milestone 3's `Tenants` module (SYSTEM_ARCHITECTURE.md Section 3.2,
 * docs/TENANT_ARCHITECTURE.md, docs/adr/ADR-006). Owns `Tenant` (profile +
 * lifecycle), `TenantSettings`, and `TenantInvitation` — separate from
 * `modules/auth`'s own minimal, read-only `Tenant` port (each module owns
 * its own data access, SYSTEM_ARCHITECTURE.md Section 2.3).
 *
 * `forwardRef(() => AuthModule)`: this module's controllers apply
 * `JwtAuthGuard`/`CurrentUser` (Auth-owned) and `TenantInvitationService`
 * uses Auth's `TokenService` — while `AuthModule` itself imports this
 * module (for `TenantInvitationService`, to implement
 * `POST /auth/accept-invitation`). A genuine, intentional circular module
 * dependency; see `core.module.ts`'s doc comment for the same pattern.
 *
 * `TenantLifecycleService` (suspend/reactivate) is exported for
 * `modules/admin` to call — no controller in *this* module exposes those
 * transitions directly (they're Super-Admin-only, reached via
 * `/admin/tenants/:id/{suspend,reactivate}`).
 */
@Module({
  imports: [
    // Both wrapped in forwardRef: this module, CoreModule, and AuthModule
    // form a genuine 3-way circular *file* import graph (Tenants -> Core ->
    // Auth -> Tenants), not just a NestJS DI-graph nicety — every edge on
    // the cycle needs forwardRef, or whichever module's file hasn't
    // finished executing yet at decoration time evaluates to `undefined`
    // (observed directly: booting with only some edges wrapped throws
    // Nest's `UndefinedModuleException`).
    forwardRef(() => CoreModule),
    forwardRef(() => AuthModule),
    NotificationsModule,
  ],
  controllers: [
    TenantController,
    TenantSettingsController,
    TenantInvitationsController,
  ],
  providers: [
    TenantService,
    TenantSettingsService,
    TenantLifecycleService,
    TenantInvitationService,
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    {
      provide: TENANT_SETTINGS_REPOSITORY,
      useClass: PrismaTenantSettingsRepository,
    },
    {
      provide: TENANT_INVITATION_REPOSITORY,
      useClass: PrismaTenantInvitationRepository,
    },
  ],
  exports: [TenantLifecycleService, TenantService, TenantInvitationService],
})
export class TenantsModule {}
