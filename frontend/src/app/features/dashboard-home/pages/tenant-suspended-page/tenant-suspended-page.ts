import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * `/app/tenant-suspended` — the interim redirect target for
 * `tenantActiveGuard` (docs/adr/ADR-006) until Milestone 8 builds
 * `/app/billing`, FRONTEND_ARCHITECTURE.md Section 3.3's originally-intended
 * exemption target for a suspended tenant. Read-only informational page;
 * no action to take here yet since there's no billing surface to resolve
 * the suspension from.
 */
@Component({
  selector: 'app-tenant-suspended-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tenant-suspended-page.html',
})
export class TenantSuspendedPage {}
