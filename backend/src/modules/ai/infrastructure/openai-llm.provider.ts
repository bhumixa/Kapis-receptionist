import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
  LlmProviderPort,
  LlmToolDefinition,
} from '../domain/ports/llm-provider.port';

/**
 * SYSTEM_ARCHITECTURE.md 5.10's fallback strategy hinges on the caller
 * (`ConversationOrchestratorService`) having exactly one exception type to
 * catch — mirrors `WhatsAppCloudApiError`'s "typed error, caller decides
 * what to do" precedent (`whatsapp-cloud-api.client.ts`), the closest prior
 * art in this codebase for a third-party API adapter.
 */
export class LlmProviderUnavailableException extends Error {
  constructor(cause: unknown) {
    super('The LLM provider is unavailable.', { cause });
    this.name = 'LlmProviderUnavailableException';
  }
}

function isTransientOpenAiError(error: unknown): boolean {
  if (error instanceof APIError) {
    // Undefined status covers connection/timeout errors (no HTTP response
    // was ever received) — treated as transient, same as a 5xx/429.
    return (
      error.status === undefined || error.status >= 500 || error.status === 429
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toOpenAiMessage(message: LlmMessage): ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId ?? '',
    };
  }
  return { role: message.role, content: message.content };
}

function toOpenAiTool(tool: LlmToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * The OpenAI implementation of `LlmProviderPort` (docs/adr/
 * ADR-011-ai-receptionist.md) — the only file in this module that imports
 * the `openai` package. Retry (bounded, `AI_MAX_RETRIES`, exponential
 * backoff) and timeout (`AI_REQUEST_TIMEOUT_MS`, the SDK's own per-request
 * abort) are both handled here, never leaked to the caller — `complete()`
 * either returns a real result or throws exactly one exception type.
 */
@Injectable()
export class OpenAiLlmProvider implements LlmProviderPort, OnModuleInit {
  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private client!: OpenAI;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('ai.openaiApiKey'),
      baseURL:
        this.configService.get<string | null>('ai.openaiBaseUrl') ?? undefined,
      timeout: this.configService.getOrThrow<number>('ai.requestTimeoutMs'),
      // Retries are handled explicitly below (bounded, logged, and under
      // this adapter's own transient-error classification) rather than
      // via the SDK's built-in retry, so behavior is uniform with every
      // other retry-classification precedent in this codebase (e.g.
      // `WhatsAppCloudApiError.isTransient`) and trivially unit-testable
      // by mocking this class's own `client`.
      maxRetries: 0,
    });
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const model = this.configService.getOrThrow<string>('ai.openaiModel');
    const maxRetries = this.configService.getOrThrow<number>('ai.maxRetries');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map(toOpenAiMessage),
    ];
    const tools = request.tools.map(toOpenAiTool);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
        });
        const choice = response.choices[0];
        return {
          content: choice?.message.content ?? null,
          toolCalls: (choice?.message.tool_calls ?? [])
            .filter(
              (call): call is typeof call & { type: 'function' } =>
                call.type === 'function',
            )
            .map((call) => ({
              id: call.id,
              name: call.function.name,
              arguments: parseToolArguments(call.function.arguments),
            })),
          model: response.model,
        };
      } catch (error) {
        lastError = error;
        const transient = isTransientOpenAiError(error);
        this.logger.warn(
          `OpenAI completion attempt ${attempt + 1}/${maxRetries + 1} failed (transient=${transient}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (!transient || attempt === maxRetries) {
          break;
        }
        await sleep(2 ** attempt * 500);
      }
    }

    throw new LlmProviderUnavailableException(lastError);
  }
}

/** A hallucinated/malformed tool-call-argument payload is treated as "no arguments" — `ToolExecutorService`'s own schema validation catches the resulting missing-field error, per SYSTEM_ARCHITECTURE.md 5.9's "model output is untrusted input" rule. */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
