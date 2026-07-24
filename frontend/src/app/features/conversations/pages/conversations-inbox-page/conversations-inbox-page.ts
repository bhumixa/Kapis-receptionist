import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiError } from '../../../../core/api/api-error';
import { ConversationsApiService } from '../../../../core/api/conversations-api.service';
import { CustomersApiService } from '../../../../core/api/customers-api.service';
import { Customer } from '../../../../shared/models/customer.model';
import {
  CONVERSATION_STATUS_LABELS,
  Conversation,
  ConversationStatus,
  Message,
  MESSAGE_STATUS_LABELS,
} from '../../../../shared/models/whatsapp.model';

/**
 * `/app/conversations[/:id]` (API_SPECIFICATION.md Section 11,
 * docs/MESSAGING_ARCHITECTURE.md) — a two-pane inbox: conversation list on
 * the left, message thread + contact panel + composer on the right, all in
 * one page component rather than two routed pages, since selecting a
 * conversation is a within-page interaction, not a full navigation
 * (matches the "list + detail on one page" shape `EmployeeProfilePage`
 * already uses for its sub-sections). Fetches a single generous-limit page
 * of conversations/messages rather than building cursor-pagination UI —
 * the same precedent `CustomersApiService`/`AppointmentsApiService`
 * established.
 */
@Component({
  selector: 'app-conversations-inbox-page',
  standalone: true,
  imports: [FormsModule, LowerCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conversations-inbox-page.html',
})
export class ConversationsInboxPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly conversationsApi = inject(ConversationsApiService);
  private readonly customersApi = inject(CustomersApiService);

  readonly statusLabels = CONVERSATION_STATUS_LABELS;
  readonly messageStatusLabels = MESSAGE_STATUS_LABELS;

  readonly conversations = signal<Conversation[]>([]);
  readonly customersById = signal<Record<string, Customer>>({});
  readonly isLoadingList = signal(true);
  readonly listError = signal<string | null>(null);

  readonly selectedConversationId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly messages = signal<Message[]>([]);
  readonly isLoadingMessages = signal(false);

  readonly composerText = signal('');
  readonly isSending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly statusUpdateError = signal<string | null>(null);

  readonly selectedConversation = computed<Conversation | null>(
    () => this.conversations().find((c) => c.id === this.selectedConversationId()) ?? null,
  );
  readonly selectedCustomer = computed<Customer | null>(() => {
    const conversation = this.selectedConversation();
    return conversation ? (this.customersById()[conversation.customerId] ?? null) : null;
  });
  readonly canReply = computed(() => {
    const conversation = this.selectedConversation();
    if (!conversation?.lastInboundMessageAt) {
      return false;
    }
    const hoursSinceLastInbound =
      (Date.now() - new Date(conversation.lastInboundMessageAt).getTime()) / 3_600_000;
    return hoursSinceLastInbound < 24;
  });

  constructor() {
    this.loadConversations();
    const initialId = this.selectedConversationId();
    if (initialId) {
      this.loadMessages(initialId);
    }
  }

  customerFor(conversation: Conversation): Customer | null {
    return this.customersById()[conversation.customerId] ?? null;
  }

  formatTimestamp(iso: string | null): string {
    if (!iso) {
      return '';
    }
    return iso.slice(0, 16).replace('T', ' ');
  }

  select(conversation: Conversation): void {
    this.selectedConversationId.set(conversation.id);
    this.sendError.set(null);
    this.statusUpdateError.set(null);
    void this.router.navigate(['/app/conversations', conversation.id]);
    this.loadMessages(conversation.id);
  }

  private loadConversations(): void {
    this.isLoadingList.set(true);
    this.listError.set(null);
    this.conversationsApi.listConversations().subscribe({
      next: (conversations) => {
        this.conversations.set(conversations);
        this.isLoadingList.set(false);
        this.hydrateCustomers(conversations);
      },
      error: (error: unknown) => {
        this.isLoadingList.set(false);
        this.listError.set(
          error instanceof ApiError ? error.message : 'Could not load conversations.',
        );
      },
    });
  }

  private hydrateCustomers(conversations: Conversation[]): void {
    const missingIds = Array.from(
      new Set(conversations.map((c) => c.customerId).filter((id) => !this.customersById()[id])),
    );
    if (missingIds.length === 0) {
      return;
    }
    forkJoin(
      missingIds.map((id) => this.customersApi.getCustomer(id).pipe(catchError(() => of(null)))),
    ).subscribe((customers) => {
      const next = { ...this.customersById() };
      for (const customer of customers) {
        if (customer) {
          next[customer.id] = customer;
        }
      }
      this.customersById.set(next);
    });
  }

  private loadMessages(conversationId: string): void {
    this.isLoadingMessages.set(true);
    this.conversationsApi.listMessages(conversationId).subscribe({
      next: (messages) => {
        this.messages.set(messages);
        this.isLoadingMessages.set(false);
      },
      error: () => this.isLoadingMessages.set(false),
    });
  }

  send(): void {
    const conversation = this.selectedConversation();
    const body = this.composerText().trim();
    if (!conversation || !body) {
      return;
    }
    this.isSending.set(true);
    this.sendError.set(null);
    this.conversationsApi.sendMessage({ conversationId: conversation.id, body }).subscribe({
      next: (message) => {
        this.messages.set([...this.messages(), message]);
        this.composerText.set('');
        this.isSending.set(false);
      },
      error: (error: unknown) => {
        this.isSending.set(false);
        this.sendError.set(error instanceof ApiError ? error.message : 'Could not send message.');
      },
    });
  }

  updateStatus(status: ConversationStatus): void {
    const conversation = this.selectedConversation();
    if (!conversation) {
      return;
    }
    this.statusUpdateError.set(null);
    this.conversationsApi.updateStatus(conversation.id, status).subscribe({
      next: (updated) => {
        this.conversations.set(
          this.conversations().map((c) => (c.id === updated.id ? updated : c)),
        );
      },
      error: (error: unknown) => {
        this.statusUpdateError.set(
          error instanceof ApiError ? error.message : 'Could not update status.',
        );
      },
    });
  }
}
