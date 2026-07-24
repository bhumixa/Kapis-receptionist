import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { AiContext, ChatRequest, ChatResponse, PromptVersion } from '../../shared/models/ai.model';

/**
 * `/ai/chat`, `/ai/context/:conversationId`, `/ai/prompt-versions`
 * (API_SPECIFICATION.md Section 12, docs/adr/ADR-011-ai-receptionist.md).
 * The `/ai/tools/*` internal-service endpoints are deliberately **not**
 * covered here — not part of this frontend's contract (backend doc
 * comment on `AiToolsController`).
 */
@Injectable({ providedIn: 'root' })
export class AiApiService {
  private readonly api = inject(ApiClient);

  /** `channel: "dashboard_test"` — the Settings page "Test my AI" sandbox; never delivered over WhatsApp or persisted into a real conversation. */
  chat(request: ChatRequest): Observable<ChatResponse> {
    return this.api.post<ChatResponse>('/ai/chat', request);
  }

  getContext(conversationId: string): Observable<AiContext> {
    return this.api.get<AiContext>(`/ai/context/${conversationId}`);
  }

  listPromptVersions(): Observable<PromptVersion[]> {
    return this.api.get<PromptVersion[]>('/ai/prompt-versions');
  }
}
