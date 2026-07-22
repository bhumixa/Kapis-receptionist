import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiError } from '../../../../core/api/api-error';
import { ServicesApiService } from '../../../../core/api/services-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { Service } from '../../../../shared/models/service.model';
import { ServiceCategory } from '../../../../shared/models/service-category.model';

/** `/app/services` (docs/SERVICE_ARCHITECTURE.md) — catalog list with inline create/edit/active-toggle, no modal needed. */
@Component({
  selector: 'app-services-list-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './services-list-page.html',
})
export class ServicesListPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly servicesApi = inject(ServicesApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageServices = this.permissionService.can('services:manage');

  readonly services = signal<Service[]>([]);
  readonly categories = signal<ServiceCategory[]>([]);
  readonly isLoading = signal(true);

  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    categoryId: [''],
    durationMinutes: [30, [Validators.required, Validators.min(5), Validators.max(480)]],
    price: [0, [Validators.required, Validators.min(0)]],
    bufferTimeMinutes: [0, [Validators.min(0), Validators.max(480)]],
  });

  readonly editingId = signal<string | null>(null);
  readonly isSavingEdit = signal(false);
  readonly editError = signal<string | null>(null);
  readonly editForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    categoryId: [''],
    durationMinutes: [30, [Validators.required, Validators.min(5), Validators.max(480)]],
    price: [0, [Validators.required, Validators.min(0)]],
    bufferTimeMinutes: [0, [Validators.min(0), Validators.max(480)]],
  });

  constructor() {
    this.load();
  }

  categoryName(categoryId: string | null): string {
    if (!categoryId) {
      return 'Uncategorized';
    }
    return this.categories().find((c) => c.id === categoryId)?.name ?? 'Uncategorized';
  }

  private load(): void {
    this.isLoading.set(true);
    forkJoin({
      services: this.servicesApi.listServices(),
      categories: this.servicesApi.listCategories(),
    }).subscribe({
      next: ({ services, categories }) => {
        this.services.set(services);
        this.categories.set(categories);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createService(): void {
    if (this.createForm.invalid || this.isCreating()) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.isCreating.set(true);
    this.createError.set(null);

    const raw = this.createForm.getRawValue();
    this.servicesApi
      .createService({
        name: raw.name,
        categoryId: raw.categoryId || undefined,
        durationMinutes: raw.durationMinutes,
        priceCents: Math.round(raw.price * 100),
        bufferTimeMinutes: raw.bufferTimeMinutes,
      })
      .subscribe({
        next: (service) => {
          this.isCreating.set(false);
          this.services.update((current) => [...current, service]);
          this.createForm.reset({
            name: '',
            categoryId: '',
            durationMinutes: 30,
            price: 0,
            bufferTimeMinutes: 0,
          });
        },
        error: (error: unknown) => {
          this.isCreating.set(false);
          this.createError.set(
            error instanceof ApiError ? error.message : 'Could not create the service.',
          );
        },
      });
  }

  startEdit(service: Service): void {
    this.editingId.set(service.id);
    this.editError.set(null);
    this.editForm.setValue({
      name: service.name,
      categoryId: service.categoryId ?? '',
      durationMinutes: service.durationMinutes,
      price: service.priceCents / 100,
      bufferTimeMinutes: service.bufferTimeMinutes,
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(service: Service): void {
    if (this.editForm.invalid || this.isSavingEdit()) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.isSavingEdit.set(true);
    this.editError.set(null);

    const raw = this.editForm.getRawValue();
    this.servicesApi
      .updateService(service.id, {
        name: raw.name,
        categoryId: raw.categoryId || null,
        durationMinutes: raw.durationMinutes,
        priceCents: Math.round(raw.price * 100),
        bufferTimeMinutes: raw.bufferTimeMinutes,
      })
      .subscribe({
        next: (updated) => {
          this.isSavingEdit.set(false);
          this.services.update((current) =>
            current.map((s) => (s.id === updated.id ? updated : s)),
          );
          this.editingId.set(null);
        },
        error: (error: unknown) => {
          this.isSavingEdit.set(false);
          this.editError.set(error instanceof ApiError ? error.message : 'Could not save changes.');
        },
      });
  }

  toggleActive(service: Service): void {
    this.servicesApi.updateService(service.id, { isActive: !service.isActive }).subscribe({
      next: (updated) => {
        this.services.update((current) => current.map((s) => (s.id === updated.id ? updated : s)));
      },
    });
  }

  deleteService(service: Service): void {
    if (!confirm(`Remove "${service.name}" from the catalog?`)) {
      return;
    }
    this.servicesApi.deleteService(service.id).subscribe({
      next: () => {
        this.services.update((current) => current.filter((s) => s.id !== service.id));
      },
    });
  }
}
