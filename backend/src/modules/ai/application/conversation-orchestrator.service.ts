import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import {
  readBooleanSetting,
  readNumberSetting,
  readObjectSetting,
  readStringSetting,
} from '../../../common/utils/json-settings.util';
import type { AiActorContext } from '../../appointments/application/appointments.service';
import { SalonProfileService } from '../../salon/application/salon-profile.service';
import { TenantSettingsService } from '../../tenants/application/tenant-settings.service';
import { ConversationsService } from '../../whatsapp/application/conversations.service';
import { MessagesService } from '../../whatsapp/application/messages.service';
import { AiContextService } from './ai-context.service';
import { ConversationSummaryService } from './conversation-summary.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ToolExecutorService } from './tool-executor.service';
import {
  LLM_PROVIDER,
  type LlmMessage,
  type LlmProviderPort,
  type LlmToolCall,
} from '../domain/ports/llm-provider.port';
import { LlmProviderUnavailableException } from '../infrastructure/openai-llm.provider';
import { TOOL_DEFINITIONS } from './tool-definitions';

const MAX_TOOL_ROUNDS = 3;
const DEFAULT_FALLBACK_MESSAGE =
  "We're experiencing an issue on our end — a team member will follow up with you shortly.";
const DEFAULT_TONE = 'friendly and professional';

export interface ChatTurnInput {
  tenantId: string;
  /** `null` only for a dashboard-test turn with no existing conversation to preview against. */
  conversationId: string | null;
  message: string;
  /** `false` for `channel: "dashboard_test"` — no `Message` row, no outbound send, no `AIContext` write, and every tool call is simulated rather than executed (docs/adr/ADR-011-ai-receptionist.md). */
  persist: boolean;
}

export interface ChatTurnResult {
  conversationId: string | null;
  messageId: string | null;
  replyText: string;
  toolCallsExecuted: Array<{ tool: string; result: unknown }>;
  promptVersion: string | null;
  degraded: boolean;
}

interface ToolCallingLoopResult {
  content: string | null;
  toolCallsExecuted: Array<{ tool: string; result: unknown }>;
}

/**
 * The AI module's entry point (SYSTEM_ARCHITECTURE.md 5.1-5.10) — assembles
 * grounded context, drives the tool-calling loop against `LlmProviderPort`,
 * and persists the result via the exact same `MessagesService`/
 * `AiContextService` every other caller uses. Called in-process by
 * `InboundMessageProcessorService` for real WhatsApp traffic (no HTTP hop,
 * docs/adr/ADR-011) and by `AiChatController` for both the internal-service
 * and dashboard-test `POST /ai/chat` paths.
 */
@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);

  constructor(
    private readonly aiContext: AiContextService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly conversationSummary: ConversationSummaryService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly salonProfile: SalonProfileService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProviderPort,
  ) {}

  async runTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
    const { tenantId } = input;
    const conversation = input.conversationId
      ? await this.conversationsService.getConversation(
          tenantId,
          input.conversationId,
        )
      : null;

    const [profile, settings] = await Promise.all([
      this.salonProfile.getProfile(tenantId),
      this.tenantSettings.getSettings(tenantId),
    ]);
    const aiSettings = readObjectSetting(settings.general, 'ai');
    const enabled = readBooleanSetting(aiSettings, 'enabled', true);
    const tone = readStringSetting(aiSettings, 'tone', DEFAULT_TONE);
    const greetingMessage =
      readStringSetting(aiSettings, 'greetingMessage', '') || null;
    const escalationInstructions =
      readStringSetting(aiSettings, 'escalationInstructions', '') || null;
    const fallbackMessage =
      readStringSetting(aiSettings, 'fallbackMessage', '') ||
      DEFAULT_FALLBACK_MESSAGE;
    const repeatedReplyEscalationThreshold = readNumberSetting(
      aiSettings,
      'confidenceThreshold',
      2,
    );

    if (!enabled && conversation) {
      await this.conversationsService.escalateConversation(
        tenantId,
        conversation.id,
        'AI receptionist is disabled for this tenant.',
        ActorType.SYSTEM,
      );
      return {
        conversationId: conversation.id,
        messageId: null,
        replyText: fallbackMessage,
        toolCallsExecuted: [],
        promptVersion: null,
        degraded: true,
      };
    }

    const aiCtx = conversation
      ? await this.aiContext.getContext(tenantId, conversation.id)
      : null;

    const history = conversation
      ? await this.loadHistoryMessages(tenantId, conversation.id)
      : [];
    const messages: LlmMessage[] = [
      ...history,
      { role: 'user', content: input.message },
    ];

    const { prompt: systemPrompt, promptVersion } =
      this.promptBuilder.buildSystemPrompt({
        tenantName: profile.name,
        tenantTimezone: profile.timezone,
        tone,
        greetingMessage,
        escalationInstructions,
        conversationStateSummary: aiCtx?.currentIntent
          ? `Current intent: ${aiCtx.currentIntent}. State: ${JSON.stringify(aiCtx.state)}.`
          : null,
      });

    let completion: ToolCallingLoopResult;
    try {
      completion = await this.runToolCallingLoop(
        tenantId,
        conversation?.id ?? null,
        systemPrompt,
        messages,
        input.persist,
      );
    } catch (error) {
      if (error instanceof LlmProviderUnavailableException) {
        this.logger.warn(
          `LLM provider unavailable for tenant ${tenantId}: ${error.message}`,
        );
        if (conversation) {
          await this.conversationsService.escalateConversation(
            tenantId,
            conversation.id,
            'AI provider unavailable.',
            ActorType.SYSTEM,
          );
        }
        return {
          conversationId: conversation?.id ?? null,
          messageId: null,
          replyText: fallbackMessage,
          toolCallsExecuted: [],
          promptVersion: null,
          degraded: true,
        };
      }
      throw error;
    }

    const replyText = completion.content?.trim() || fallbackMessage;

    let messageId: string | null = null;
    if (input.persist && conversation) {
      const message = await this.messagesService.sendAiMessage(tenantId, {
        conversationId: conversation.id,
        body: replyText,
        promptVersion,
      });
      messageId = message.id;

      const escalated = completion.toolCallsExecuted.some(
        (call) => call.tool === 'escalateToHuman',
      );
      const repeatedReplyCount = await this.trackRepeatedReplies(
        tenantId,
        conversation.id,
        replyText,
        aiCtx?.state ?? {},
      );
      if (
        !escalated &&
        repeatedReplyCount >= repeatedReplyEscalationThreshold
      ) {
        await this.conversationsService.escalateConversation(
          tenantId,
          conversation.id,
          'Repeated clarification loop detected.',
          ActorType.AI,
        );
      }
      if (escalated) {
        await this.conversationSummary.regenerate(
          tenantId,
          conversation.id,
          aiCtx?.currentIntent ?? null,
          promptVersion,
        );
      }
    }

    return {
      conversationId: conversation?.id ?? null,
      messageId,
      replyText,
      toolCallsExecuted: completion.toolCallsExecuted,
      promptVersion,
      degraded: false,
    };
  }

  private async loadHistoryMessages(
    tenantId: string,
    conversationId: string,
  ): Promise<LlmMessage[]> {
    const maxHistory = 20;
    const recent = await this.messagesService.listMessages(
      tenantId,
      conversationId,
      { sortDirection: 'desc', cursor: null, limit: maxHistory },
    );
    return recent
      .slice()
      .reverse()
      .filter((message) => !!message.content)
      .map((message) => ({
        role: message.senderType === 'CUSTOMER' ? 'user' : 'assistant',
        content: message.content ?? '',
      }));
  }

  private async runToolCallingLoop(
    tenantId: string,
    conversationId: string | null,
    systemPrompt: string,
    initialMessages: LlmMessage[],
    persist: boolean,
  ): Promise<ToolCallingLoopResult> {
    const messages = [...initialMessages];
    const toolCallsExecuted: Array<{ tool: string; result: unknown }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await this.llm.complete({
        systemPrompt,
        messages,
        tools: TOOL_DEFINITIONS,
      });

      if (result.toolCalls.length === 0) {
        return { content: result.content, toolCallsExecuted };
      }

      messages.push({
        role: 'assistant',
        content: result.content ?? '',
      });

      for (const toolCall of result.toolCalls) {
        const outcome = await this.dispatchTool(
          tenantId,
          conversationId,
          toolCall,
          persist,
        );
        toolCallsExecuted.push({ tool: toolCall.name, result: outcome });
        messages.push({
          role: 'tool',
          content: JSON.stringify(outcome),
          toolCallId: toolCall.id,
          name: toolCall.name,
        });
      }
    }

    this.logger.warn(
      `Tool-calling loop exhausted ${MAX_TOOL_ROUNDS} rounds for tenant ${tenantId}, conversation ${conversationId ?? 'n/a'}.`,
    );
    return {
      content:
        "I'm having trouble completing that — let me get a team member to help.",
      toolCallsExecuted,
    };
  }

  private async dispatchTool(
    tenantId: string,
    conversationId: string | null,
    toolCall: LlmToolCall,
    persist: boolean,
  ): Promise<unknown> {
    if (!persist) {
      return {
        simulated: true,
        note: 'Dashboard test mode — no real action was taken.',
      };
    }
    if (!conversationId) {
      return { error: 'NO_CONVERSATION', message: 'No active conversation.' };
    }

    const aiActor: AiActorContext = { actorType: ActorType.AI, conversationId };
    const args = toolCall.arguments;

    try {
      switch (toolCall.name) {
        case 'checkAvailability':
          return await this.toolExecutor.checkAvailability(tenantId, {
            serviceId: asString(args.serviceId),
            employeeId: args.employeeId ? asString(args.employeeId) : undefined,
            dateFrom: asString(args.dateFrom),
            dateTo: asString(args.dateTo),
          });
        case 'bookAppointment': {
          const conversation = await this.conversationsService.getConversation(
            tenantId,
            conversationId,
          );
          return await this.toolExecutor.book(tenantId, aiActor, {
            customerId: conversation.customerId,
            startTime: new Date(asString(args.startTime)),
            services: parseServiceLines(args.services),
            notes: args.notes ? asString(args.notes) : null,
          });
        }
        case 'rescheduleAppointment':
          return await this.toolExecutor.reschedule(
            tenantId,
            asString(args.appointmentId),
            aiActor,
            {
              newStartTime: new Date(asString(args.newStartTime)),
              services: args.services
                ? parseServiceLines(args.services)
                : undefined,
            },
          );
        case 'cancelAppointment':
          return await this.toolExecutor.cancel(
            tenantId,
            asString(args.appointmentId),
            args.reason ? asString(args.reason) : undefined,
            aiActor,
          );
        case 'recommendService':
          return await this.toolExecutor.recommendService(tenantId, {
            q: args.q ? asString(args.q) : undefined,
          });
        case 'answerFaq':
          return await this.toolExecutor.answerFaq(
            tenantId,
            asString(args.question),
          );
        case 'escalateToHuman':
          return await this.toolExecutor.escalateToHuman(
            tenantId,
            conversationId,
            asString(args.reason, 'Escalation requested.'),
          );
        default:
          return { error: 'UNKNOWN_TOOL', tool: toolCall.name };
      }
    } catch (error) {
      // SYSTEM_ARCHITECTURE.md 5.10: a tool failure is fed back to the
      // model as a structured result, never a raw exception surfaced to
      // the customer — the model is instructed (system prompt) to offer
      // alternatives or escalate gracefully on seeing an `error` field.
      return {
        error: 'TOOL_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Lightweight proxy for SYSTEM_ARCHITECTURE.md 5.10's "the same clarifying question loops" — no real model-reported confidence score exists, so an exact-repeat reply counter is the concrete, testable signal used instead. */
  private async trackRepeatedReplies(
    tenantId: string,
    conversationId: string,
    replyText: string,
    currentState: Record<string, unknown>,
  ): Promise<number> {
    const lastReply = currentState.lastAiReply;
    const previousCount =
      typeof currentState.repeatedReplyCount === 'number'
        ? currentState.repeatedReplyCount
        : 0;
    const repeatedReplyCount = lastReply === replyText ? previousCount + 1 : 0;

    await this.aiContext.updateContext(tenantId, conversationId, {
      state: { lastAiReply: replyText, repeatedReplyCount },
    });

    return repeatedReplyCount;
  }
}

/** The model's tool-call arguments are untrusted JSON (SYSTEM_ARCHITECTURE.md 5.9) — never `String(unknown)` on them (which would silently stringify a malformed object to "[object Object]"); a non-string value becomes `fallback`, which every tool's own server-side re-validation then correctly rejects. */
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseServiceLines(
  raw: unknown,
): Array<{ serviceId: string; employeeId: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (line): line is Record<string, unknown> =>
        typeof line === 'object' && line !== null,
    )
    .map((line) => ({
      serviceId: asString(line.serviceId),
      employeeId: asString(line.employeeId),
    }));
}
