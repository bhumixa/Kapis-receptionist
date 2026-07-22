import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { PermissionService } from '../../core/auth/permission.service';

/**
 * Structural directive hiding its host template when the current user
 * lacks the given permission (docs/adr/ADR-005-rbac.md, UI permission
 * directives deliverable). UX only — `PermissionService` never a security
 * boundary; the backend's `PermissionGuard` remains authoritative.
 *
 * Usage: `<button *appHasPermission="'staff:invite'">Invite Staff</button>`.
 *
 * Hide-only this sprint. A "disable rather than hide" variant is a natural
 * follow-on (e.g. an `else`-template toggling a `disabled` attribute
 * instead of removing the element) but isn't built speculatively here.
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly permissionService = inject(PermissionService);
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  readonly appHasPermission = input.required<string>();

  constructor() {
    effect(() => {
      const allowed = this.permissionService.can(this.appHasPermission())();
      this.viewContainer.clear();
      if (allowed) {
        this.viewContainer.createEmbeddedView(this.templateRef);
      }
    });
  }
}
