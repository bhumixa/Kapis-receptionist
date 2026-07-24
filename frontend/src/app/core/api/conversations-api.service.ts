import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import {
  Conversation,
  ConversationStatus,
  Message,
  WhatsAppAccount,
} from '../../shared/models/whatsapp.model';

export interface ListConversationsFilter {
  status?: ConversationStatus[];
}

export interface SendMessageRequest {
  conversationId: string;
  body: string;
}

export interface ConnectWhatsAppAccountRequest {
  phoneNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  accessToken: string;
}

/**
 * `/conversations[/:id]`, `/messages[/send]`, `/whatsapp/account`
 * (API_SPECIFICATION.md Section 11, docs/WHATSAPP_ARCHITECTURE.md). Fetches
 * a single generous-limit page rather than building cursor-pagination UI —
 * the same precedent `CustomersApiService`/`EmployeesApiService` already
 * established for this milestone's scope. `sendMessage` attaches its own
 * `Idempotency-Key` per send, matching `AppointmentsApiService`'s existing
 * booking-critical-write convention.
 */
@Injectable({ providedIn: 'root' })
export class ConversationsApiService {
  private readonly api = inject(ApiClient);

  listConversations(filter: ListConversationsFilter = {}): Observable<Conversation[]> {
    const params: Record<string, string | number> = { limit: 100 };
    if (filter.status?.length) {
      params['status'] = filter.status.join(',');
    }
    return this.api.get<Conversation[]>('/conversations', { params });
  }

  getConversation(id: string): Observable<Conversation> {
    return this.api.get<Conversation>(`/conversations/${id}`);
  }

  updateStatus(id: string, status: ConversationStatus): Observable<Conversation> {
    return this.api.patch<Conversation>(`/conversations/${id}`, { status });
  }

  listMessages(conversationId: string): Observable<Message[]> {
    return this.api.get<Message[]>('/messages', {
      params: { conversationId, limit: 200 },
    });
  }

  sendMessage(request: SendMessageRequest): Observable<Message> {
    return this.api.post<Message>('/messages/send', request, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  getAccount(): Observable<WhatsAppAccount | null> {
    return this.api.get<WhatsAppAccount | null>('/whatsapp/account');
  }

  connectAccount(request: ConnectWhatsAppAccountRequest): Observable<WhatsAppAccount> {
    return this.api.post<WhatsAppAccount>('/whatsapp/account', request);
  }

  disconnectAccount(): Observable<WhatsAppAccount> {
    return this.api.delete<WhatsAppAccount>('/whatsapp/account');
  }
}
