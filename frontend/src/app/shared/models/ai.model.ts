/** Mirrors `backend/src/modules/ai/interface/dto/*.dto.ts` (Milestone 8, docs/adr/ADR-011-ai-receptionist.md). */

export interface AiContext {
  conversationId: string;
  currentIntent: string | null;
  state: Record<string, unknown>;
  lastToolCall: string | null;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  key: string;
  version: string;
  description: string | null;
  isActive: boolean;
  releasedAt: string | null;
  createdAt: string;
}

export type ChatChannel = 'whatsapp' | 'dashboard_test';

export interface ChatRequest {
  conversationId?: string;
  message: string;
  channel: ChatChannel;
}

export interface ChatToolCallExecuted {
  tool: string;
  result: unknown;
}

export interface ChatResponse {
  conversationId: string | null;
  messageId: string | null;
  replyText: string;
  toolCallsExecuted: ChatToolCallExecuted[];
  promptVersion: string | null;
  meta: { degraded: boolean };
}

/** `TenantSettings.general.ai` (application-layer namespace, no schema migration — see `backend/prisma/schema.prisma`'s `TenantSettings` doc comment). */
export interface AiBehaviorSettings {
  enabled: boolean;
  tone: string;
  greetingMessage: string;
  escalationInstructions: string;
  fallbackMessage: string;
  confidenceThreshold: number;
}

export const DEFAULT_AI_BEHAVIOR_SETTINGS: AiBehaviorSettings = {
  enabled: true,
  tone: 'friendly and professional',
  greetingMessage: '',
  escalationInstructions: '',
  fallbackMessage: '',
  confidenceThreshold: 2,
};
