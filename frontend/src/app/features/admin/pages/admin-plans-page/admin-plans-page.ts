import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, UpdatePlanRequest } from '../../../../core/api/admin-api.service';
import { Plan } from '../../../../shared/models/billing.model';

interface PlanDraft {
  name: string;
  monthlyPriceDollars: number;
  maxStaff: number | null;
  maxMessagesPerMonth: number | null;
  maxAppointmentsPerMonth: number | null;
  maxLocations: number;
  maxStorageMb: number | null;
  trialDays: number;
  isActive: boolean;
}

function toDraft(plan: Plan): PlanDraft {
  return {
    name: plan.name,
    monthlyPriceDollars: plan.monthlyPriceCents / 100,
    maxStaff: plan.maxStaff,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    maxAppointmentsPerMonth: plan.maxAppointmentsPerMonth,
    maxLocations: plan.maxLocations,
    maxStorageMb: plan.maxStorageMb,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
  };
}

/**
 * `/admin/plans` — Platform Admin plan management (`GET/PATCH /admin/plans[/:id]`,
 * Milestone 9 deliverable "Platform admin pages for: Plans"). Retired plans
 * are deactivated (`isActive: false`), never deleted — existing
 * subscriptions must keep a valid `planId` FK (docs/BILLING_ARCHITECTURE.md).
 */
@Component({
  selector: 'app-admin-plans-page',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-plans-page.html',
})
export class AdminPlansPage {
  private readonly adminApi = inject(AdminApiService);

  readonly plans = signal<Plan[]>([]);
  readonly isLoading = signal(true);
  readonly editingPlanId = signal<string | null>(null);
  readonly draft = signal<PlanDraft | null>(null);
  readonly isSaving = signal(false);

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.adminApi.listPlans().subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  startEdit(plan: Plan): void {
    this.editingPlanId.set(plan.id);
    this.draft.set(toDraft(plan));
  }

  cancelEdit(): void {
    this.editingPlanId.set(null);
    this.draft.set(null);
  }

  save(plan: Plan): void {
    const draft = this.draft();
    if (!draft || this.isSaving()) {
      return;
    }
    const request: UpdatePlanRequest = {
      name: draft.name,
      monthlyPriceCents: Math.round(draft.monthlyPriceDollars * 100),
      maxStaff: draft.maxStaff,
      maxMessagesPerMonth: draft.maxMessagesPerMonth,
      maxAppointmentsPerMonth: draft.maxAppointmentsPerMonth,
      maxLocations: draft.maxLocations,
      maxStorageMb: draft.maxStorageMb,
      trialDays: draft.trialDays,
      isActive: draft.isActive,
    };
    this.isSaving.set(true);
    this.adminApi.updatePlan(plan.id, request).subscribe({
      next: (updated) => {
        this.plans.update((current) => current.map((p) => (p.id === updated.id ? updated : p)));
        this.isSaving.set(false);
        this.cancelEdit();
      },
      error: () => this.isSaving.set(false),
    });
  }

  toggleActive(plan: Plan): void {
    this.adminApi.updatePlan(plan.id, { isActive: !plan.isActive }).subscribe({
      next: (updated) => {
        this.plans.update((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      },
    });
  }

  updateDraft<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]): void {
    const current = this.draft();
    if (current) {
      this.draft.set({ ...current, [key]: value });
    }
  }
}
