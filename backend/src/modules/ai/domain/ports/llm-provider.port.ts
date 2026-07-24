export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmMessageRole;
  /** Always populated for `system`/`user`; may be empty for an `assistant` turn that only carried tool calls. */
  content: string;
  /** Set only on `role: 'tool'` — which prior tool call this message is the result of. */
  toolCallId?: string;
  /** Set only on `role: 'tool'` — the tool name, mirroring OpenAI's tool-message shape. */
  name?: string;
}

/** A tool's contract, expressed as a JSON-Schema `parameters` object — provider-agnostic (SYSTEM_ARCHITECTURE.md 5.3/5.4). */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Already JSON-parsed — the provider adapter is responsible for parsing the raw string the model returns; a malformed payload is a provider-adapter concern, not the orchestrator's. */
  arguments: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  systemPrompt: string;
  /** Bounded recent-history window (SYSTEM_ARCHITECTURE.md 5.2/5.7) — never the full conversation. */
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmCompletionResult {
  /** The model's final natural-language reply. `null` when the model's turn was tool-calls-only (the orchestrator executes them and calls again). */
  content: string | null;
  toolCalls: LlmToolCall[];
  /** Provider-reported model/version string, recorded for telemetry — distinct from this platform's own `PromptVersion` registry. */
  model: string;
}

/**
 * The AI module's one seam to the outside world (docs/adr/
 * ADR-011-ai-receptionist.md, SYSTEM_ARCHITECTURE.md 5.3/5.4) — every other
 * application-layer service in this module depends on this interface, never
 * directly on the `openai` package. Swapping providers (a different vendor,
 * a self-hosted model) means writing one new adapter class, not touching
 * `ConversationOrchestratorService`/`ToolExecutorService`.
 *
 * Retry/timeout/fallback handling (SYSTEM_ARCHITECTURE.md 5.10) is the
 * adapter's responsibility, not the caller's — `complete()` either resolves
 * with a real result or rejects with `LlmProviderUnavailableException`
 * after its own bounded retry budget is exhausted, so
 * `ConversationOrchestratorService` has exactly one failure case to handle.
 */
export interface LlmProviderPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
