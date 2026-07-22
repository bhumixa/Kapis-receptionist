import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { ServicesApiService } from '../../../../core/api/services-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { ServiceCategory } from '../../../../shared/models/service-category.model';

/** `/app/services/categories` (docs/SERVICE_ARCHITECTURE.md) — list + inline add/edit/delete, mirrors `HolidaysPage`'s pattern. */
@Component({
  selector: 'app-service-categories-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './service-categories-page.html',
})
export class ServiceCategoriesPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly servicesApi = inject(ServicesApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageServices = this.permissionService.can('services:manage');

  readonly categories = signal<ServiceCategory[]>([]);
  readonly isLoading = signal(true);

  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    displayOrder: [0],
  });

  readonly editingId = signal<string | null>(null);
  readonly isSavingEdit = signal(false);
  readonly editError = signal<string | null>(null);
  readonly editForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    displayOrder: [0],
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.servicesApi.listCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createCategory(): void {
    if (this.createForm.invalid || this.isCreating()) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.isCreating.set(true);
    this.createError.set(null);

    this.servicesApi.createCategory(this.createForm.getRawValue()).subscribe({
      next: (category) => {
        this.isCreating.set(false);
        this.categories.update((current) =>
          [...current, category].sort((a, b) => a.displayOrder - b.displayOrder),
        );
        this.createForm.reset({ name: '', displayOrder: 0 });
      },
      error: (error: unknown) => {
        this.isCreating.set(false);
        this.createError.set(
          error instanceof ApiError ? error.message : 'Could not create the category.',
        );
      },
    });
  }

  startEdit(category: ServiceCategory): void {
    this.editingId.set(category.id);
    this.editError.set(null);
    this.editForm.setValue({ name: category.name, displayOrder: category.displayOrder });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(category: ServiceCategory): void {
    if (this.editForm.invalid || this.isSavingEdit()) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.isSavingEdit.set(true);
    this.editError.set(null);

    this.servicesApi.updateCategory(category.id, this.editForm.getRawValue()).subscribe({
      next: (updated) => {
        this.isSavingEdit.set(false);
        this.categories.update((current) =>
          current
            .map((c) => (c.id === updated.id ? updated : c))
            .sort((a, b) => a.displayOrder - b.displayOrder),
        );
        this.editingId.set(null);
      },
      error: (error: unknown) => {
        this.isSavingEdit.set(false);
        this.editError.set(error instanceof ApiError ? error.message : 'Could not save changes.');
      },
    });
  }

  deleteCategory(category: ServiceCategory): void {
    if (
      !confirm(`Delete the "${category.name}" category? Services in it will become uncategorized.`)
    ) {
      return;
    }
    this.servicesApi.deleteCategory(category.id).subscribe({
      next: () => {
        this.categories.update((current) => current.filter((c) => c.id !== category.id));
      },
    });
  }
}
