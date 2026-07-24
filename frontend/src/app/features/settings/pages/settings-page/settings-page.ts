import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TenantApiService } from '../../../../core/api/tenant-api.service';
import { ConversationsApiService } from '../../../../core/api/conversations-api.service';
import { AiApiService } from '../../../../core/api/ai-api.service';
import { ApiError } from '../../../../core/api/api-error';
import { PermissionService } from '../../../../core/auth/permission.service';
import { Invitation } from '../../../../shared/models/invitation.model';
import { WhatsAppAccount } from '../../../../shared/models/whatsapp.model';
import {
  AiBehaviorSettings,
  ChatResponse,
  DEFAULT_AI_BEHAVIOR_SETTINGS,
  PromptVersion,
} from '../../../../shared/models/ai.model';
import {
  TENANT_SETTINGS_CATEGORIES,
  TenantSettingsCategory,
} from '../../../../shared/models/tenant-settings.model';

/**
 * `/app/settings` (docs/FRONTEND_ARCHITECTURE.md Section 3.2, docs/adr/
 * ADR-006). Three sections against this milestone's real endpoints:
 * salon profile (`PATCH /tenant`), the five namespaced settings blocks
 * (`PATCH /tenant/settings` — shown as raw JSON per namespace, since none
 * has concrete fields defined until Scheduling/AI/Notifications populate
 * theirs), and team invitations (`/tenant/invitations/*`).
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenantApi = inject(TenantApiService);
  private readonly conversationsApi = inject(ConversationsApiService);
  private readonly aiApi = inject(AiApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageTenant = this.permissionService.can('tenant:manage');
  readonly canManageSettings = this.permissionService.can('settings:manage');
  readonly canInviteStaff = this.permissionService.can('staff:invite');
  readonly canManageWhatsApp = this.permissionService.can('whatsapp:manage');
  readonly canManageAi = this.permissionService.can('ai:manage');

  readonly categories = TENANT_SETTINGS_CATEGORIES;

  // --- Salon profile ---
  readonly isLoadingProfile = signal(true);
  readonly isSavingProfile = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileSaved = signal(false);
  readonly profileForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    addressLine1: [''],
    city: [''],
    countryCode: [''],
    timezone: ['', Validators.required],
    defaultLocale: ['en'],
  });

  // --- Namespaced settings (raw JSON per category) ---
  readonly isLoadingSettings = signal(true);
  readonly isSavingSettings = signal(false);
  readonly settingsError = signal<string | null>(null);
  readonly settingsSaved = signal(false);
  readonly settingsForm = this.formBuilder.nonNullable.group({
    general: ['{}'],
    localization: ['{}'],
    business: ['{}'],
    notifications: ['{}'],
    security: ['{}'],
  });

  // --- Team invitations ---
  readonly invitations = signal<Invitation[]>([]);
  readonly isLoadingInvitations = signal(true);
  readonly isInviting = signal(false);
  readonly inviteError = signal<string | null>(null);
  readonly inviteSuccess = signal<string | null>(null);
  readonly inviteForm = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'STAFF' | 'MANAGER'],
  });

  // --- WhatsApp connection (Milestone 7, docs/WHATSAPP_ARCHITECTURE.md) ---
  readonly whatsappAccount = signal<WhatsAppAccount | null>(null);
  readonly isLoadingWhatsApp = signal(true);
  readonly isConnectingWhatsApp = signal(false);
  readonly whatsappError = signal<string | null>(null);
  readonly connectWhatsAppForm = this.formBuilder.nonNullable.group({
    phoneNumber: ['', Validators.required],
    whatsappPhoneNumberId: ['', Validators.required],
    whatsappBusinessAccountId: ['', Validators.required],
    accessToken: ['', Validators.required],
  });

  // --- AI Behavior (Milestone 8, docs/adr/ADR-011-ai-receptionist.md) ---
  // Typed editor for the `general.ai` subtree — the raw "general" textarea
  // above excludes this key on read/save so the two editors never race
  // (the backend's `PATCH /tenant/settings` shallow-merges each namespace
  // by top-level key, so this is a UX clarity choice, not a correctness
  // requirement — see `prisma-tenant-settings.repository.ts`).
  readonly isLoadingAi = signal(true);
  readonly isSavingAi = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly aiSaved = signal(false);
  readonly aiForm = this.formBuilder.nonNullable.group({
    enabled: [true],
    tone: [DEFAULT_AI_BEHAVIOR_SETTINGS.tone],
    greetingMessage: [''],
    escalationInstructions: [''],
    fallbackMessage: [''],
    confidenceThreshold: [DEFAULT_AI_BEHAVIOR_SETTINGS.confidenceThreshold, [Validators.min(1)]],
  });

  readonly promptVersions = signal<PromptVersion[]>([]);
  readonly isLoadingPromptVersions = signal(true);

  readonly testMessage = signal('');
  readonly testConversationId = signal('');
  readonly isTesting = signal(false);
  readonly testError = signal<string | null>(null);
  readonly testResult = signal<ChatResponse | null>(null);

  constructor() {
    this.loadProfile();
    this.loadSettings();
    this.loadInvitations();
    this.loadWhatsAppAccount();
    this.loadPromptVersions();
  }

  private loadProfile(): void {
    this.isLoadingProfile.set(true);
    this.tenantApi.getTenant().subscribe({
      next: (tenant) => {
        this.profileForm.patchValue({
          name: tenant.name,
          addressLine1: tenant.addressLine1 ?? '',
          city: tenant.city ?? '',
          countryCode: tenant.countryCode ?? '',
          timezone: tenant.timezone,
          defaultLocale: tenant.defaultLocale,
        });
        this.isLoadingProfile.set(false);
      },
      error: () => this.isLoadingProfile.set(false),
    });
  }

  private loadSettings(): void {
    this.isLoadingSettings.set(true);
    this.isLoadingAi.set(true);
    this.tenantApi.getSettings().subscribe({
      next: (settings) => {
        const { ai, ...generalWithoutAi } = settings.general as {
          ai?: Partial<AiBehaviorSettings>;
        };
        this.settingsForm.patchValue({
          general: JSON.stringify(generalWithoutAi, null, 2),
          localization: JSON.stringify(settings.localization, null, 2),
          business: JSON.stringify(settings.business, null, 2),
          notifications: JSON.stringify(settings.notifications, null, 2),
          security: JSON.stringify(settings.security, null, 2),
        });
        this.aiForm.patchValue({ ...DEFAULT_AI_BEHAVIOR_SETTINGS, ...ai });
        this.isLoadingSettings.set(false);
        this.isLoadingAi.set(false);
      },
      error: () => {
        this.isLoadingSettings.set(false);
        this.isLoadingAi.set(false);
      },
    });
  }

  private loadInvitations(): void {
    this.isLoadingInvitations.set(true);
    this.tenantApi.listInvitations().subscribe({
      next: (invitations) => {
        this.invitations.set(invitations);
        this.isLoadingInvitations.set(false);
      },
      error: () => this.isLoadingInvitations.set(false),
    });
  }

  saveProfile(): void {
    if (this.profileForm.invalid || this.isSavingProfile()) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.isSavingProfile.set(true);
    this.profileError.set(null);
    this.profileSaved.set(false);

    this.tenantApi.updateTenant(this.profileForm.getRawValue()).subscribe({
      next: () => {
        this.isSavingProfile.set(false);
        this.profileSaved.set(true);
      },
      error: (error: unknown) => {
        this.isSavingProfile.set(false);
        this.profileError.set(error instanceof ApiError ? error.message : 'Could not save.');
      },
    });
  }

  saveSettings(): void {
    if (this.isSavingSettings()) {
      return;
    }
    this.settingsError.set(null);
    this.settingsSaved.set(false);

    const raw = this.settingsForm.getRawValue();
    const parsed: Record<string, unknown> = {};
    for (const category of this.categories) {
      try {
        parsed[category] = JSON.parse(raw[category]) as Record<string, unknown>;
      } catch {
        this.settingsError.set(`"${category}" is not valid JSON.`);
        return;
      }
    }

    this.isSavingSettings.set(true);
    this.tenantApi.updateSettings(parsed).subscribe({
      next: () => {
        this.isSavingSettings.set(false);
        this.settingsSaved.set(true);
      },
      error: (error: unknown) => {
        this.isSavingSettings.set(false);
        this.settingsError.set(error instanceof ApiError ? error.message : 'Could not save.');
      },
    });
  }

  categoryLabel(category: TenantSettingsCategory): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  sendInvite(): void {
    if (this.inviteForm.invalid || this.isInviting()) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.isInviting.set(true);
    this.inviteError.set(null);
    this.inviteSuccess.set(null);

    this.tenantApi.createInvitation(this.inviteForm.getRawValue()).subscribe({
      next: (invitation) => {
        this.isInviting.set(false);
        this.inviteSuccess.set(`Invitation sent to ${invitation.email}.`);
        this.inviteForm.reset({ email: '', role: 'STAFF' });
        this.invitations.update((current) => [invitation, ...current]);
      },
      error: (error: unknown) => {
        this.isInviting.set(false);
        this.inviteError.set(
          error instanceof ApiError && error.code === 'INVITATION_ALREADY_PENDING'
            ? 'An invitation is already pending for this email.'
            : 'Could not send the invitation.',
        );
      },
    });
  }

  revokeInvitation(invitation: Invitation): void {
    if (!confirm(`Revoke the invitation for ${invitation.email}?`)) {
      return;
    }
    this.tenantApi.revokeInvitation(invitation.id).subscribe({
      next: () => {
        this.invitations.update((current) => current.filter((i) => i.id !== invitation.id));
      },
    });
  }

  private loadWhatsAppAccount(): void {
    this.isLoadingWhatsApp.set(true);
    this.conversationsApi.getAccount().subscribe({
      next: (account) => {
        this.whatsappAccount.set(account);
        this.isLoadingWhatsApp.set(false);
      },
      error: () => this.isLoadingWhatsApp.set(false),
    });
  }

  connectWhatsApp(): void {
    if (this.connectWhatsAppForm.invalid || this.isConnectingWhatsApp()) {
      this.connectWhatsAppForm.markAllAsTouched();
      return;
    }
    this.isConnectingWhatsApp.set(true);
    this.whatsappError.set(null);

    this.conversationsApi.connectAccount(this.connectWhatsAppForm.getRawValue()).subscribe({
      next: (account) => {
        this.isConnectingWhatsApp.set(false);
        this.whatsappAccount.set(account);
        this.connectWhatsAppForm.reset();
      },
      error: (error: unknown) => {
        this.isConnectingWhatsApp.set(false);
        this.whatsappError.set(
          error instanceof ApiError ? error.message : 'Could not connect the WhatsApp account.',
        );
      },
    });
  }

  disconnectWhatsApp(): void {
    if (
      !confirm('Disconnect the WhatsApp Business account? Inbound/outbound messaging will stop.')
    ) {
      return;
    }
    this.conversationsApi.disconnectAccount().subscribe({
      next: (account) => this.whatsappAccount.set(account),
    });
  }

  saveAiBehavior(): void {
    if (this.aiForm.invalid || this.isSavingAi()) {
      this.aiForm.markAllAsTouched();
      return;
    }
    this.isSavingAi.set(true);
    this.aiError.set(null);
    this.aiSaved.set(false);

    this.tenantApi.updateSettings({ general: { ai: this.aiForm.getRawValue() } }).subscribe({
      next: () => {
        this.isSavingAi.set(false);
        this.aiSaved.set(true);
      },
      error: (error: unknown) => {
        this.isSavingAi.set(false);
        this.aiError.set(error instanceof ApiError ? error.message : 'Could not save.');
      },
    });
  }

  private loadPromptVersions(): void {
    this.isLoadingPromptVersions.set(true);
    this.aiApi.listPromptVersions().subscribe({
      next: (versions) => {
        this.promptVersions.set(versions);
        this.isLoadingPromptVersions.set(false);
      },
      error: () => this.isLoadingPromptVersions.set(false),
    });
  }

  sendTestMessage(): void {
    const message = this.testMessage().trim();
    if (!message || this.isTesting()) {
      return;
    }
    this.isTesting.set(true);
    this.testError.set(null);

    this.aiApi
      .chat({
        message,
        channel: 'dashboard_test',
        conversationId: this.testConversationId().trim() || undefined,
      })
      .subscribe({
        next: (result) => {
          this.isTesting.set(false);
          this.testResult.set(result);
          this.testMessage.set('');
        },
        error: (error: unknown) => {
          this.isTesting.set(false);
          this.testError.set(error instanceof ApiError ? error.message : 'Could not reach the AI.');
        },
      });
  }
}
