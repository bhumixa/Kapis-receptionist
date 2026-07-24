import { ActorType, ConversationStatus } from '@prisma/client';
import { AiContextService } from '../../../src/modules/ai/application/ai-context.service';
import { ConversationOrchestratorService } from '../../../src/modules/ai/application/conversation-orchestrator.service';
import { ConversationSummaryService } from '../../../src/modules/ai/application/conversation-summary.service';
import { PromptBuilderService } from '../../../src/modules/ai/application/prompt-builder.service';
import { ToolExecutorService } from '../../../src/modules/ai/application/tool-executor.service';
import { LlmProviderUnavailableException } from '../../../src/modules/ai/infrastructure/openai-llm.provider';
import { SalonProfileService } from '../../../src/modules/salon/application/salon-profile.service';
import { TenantSettingsService } from '../../../src/modules/tenants/application/tenant-settings.service';
import { EMPTY_TENANT_SETTINGS_CATEGORIES } from '../../../src/modules/tenants/domain/entities/tenant-settings.entity';
import { ConversationsService } from '../../../src/modules/whatsapp/application/conversations.service';
import { MessagesService } from '../../../src/modules/whatsapp/application/messages.service';
import type { LlmProviderPort } from '../../../src/modules/ai/domain/ports/llm-provider.port';

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    whatsappAccountId: 'account-1',
    status: ConversationStatus.OPEN,
    assignedUserId: null,
    lastMessageAt: new Date(),
    lastInboundMessageAt: new Date(),
    escalatedAt: null,
    escalationReason: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSettings(aiOverrides: Record<string, unknown> = {}) {
  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    ...EMPTY_TENANT_SETTINGS_CATEGORIES,
    general: { ai: { enabled: true, ...aiOverrides } },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProfile() {
  return {
    tenantId: 'tenant-1',
    name: 'Bella Salon',
    addressLine1: null,
    addressLine2: null,
    city: null,
    countryCode: null,
    timezone: 'UTC',
    defaultLocale: 'en',
    description: null,
    contactEmail: null,
    contactPhone: null,
    website: null,
    currency: 'USD',
    logoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    updatedAt: new Date(),
  };
}

describe('ConversationOrchestratorService', () => {
  let aiContext: jest.Mocked<
    Pick<AiContextService, 'getContext' | 'updateContext'>
  >;
  let promptBuilder: jest.Mocked<
    Pick<PromptBuilderService, 'buildSystemPrompt'>
  >;
  let toolExecutor: jest.Mocked<
    Pick<
      ToolExecutorService,
      | 'checkAvailability'
      | 'book'
      | 'reschedule'
      | 'cancel'
      | 'recommendService'
      | 'answerFaq'
      | 'escalateToHuman'
    >
  >;
  let conversationSummary: jest.Mocked<
    Pick<ConversationSummaryService, 'regenerate'>
  >;
  let conversationsService: jest.Mocked<
    Pick<ConversationsService, 'getConversation' | 'escalateConversation'>
  >;
  let messagesService: jest.Mocked<
    Pick<MessagesService, 'sendAiMessage' | 'listMessages'>
  >;
  let tenantSettings: jest.Mocked<Pick<TenantSettingsService, 'getSettings'>>;
  let salonProfile: jest.Mocked<Pick<SalonProfileService, 'getProfile'>>;
  let llm: jest.Mocked<LlmProviderPort>;
  let orchestrator: ConversationOrchestratorService;

  beforeEach(() => {
    aiContext = {
      getContext: jest.fn().mockResolvedValue({
        id: 'ctx-1',
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        currentIntent: null,
        state: {},
        lastToolCall: null,
        updatedAt: new Date(),
      }),
      updateContext: jest.fn().mockResolvedValue(undefined),
    };
    promptBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: 'system prompt',
        promptVersion: 'system-prompt@v1',
      }),
    };
    toolExecutor = {
      checkAvailability: jest.fn(),
      book: jest.fn(),
      reschedule: jest.fn(),
      cancel: jest.fn(),
      recommendService: jest.fn(),
      answerFaq: jest.fn(),
      escalateToHuman: jest.fn().mockResolvedValue({
        conversationId: 'conversation-1',
        status: ConversationStatus.ESCALATED,
      }),
    };
    conversationSummary = {
      regenerate: jest.fn().mockResolvedValue(undefined),
    };
    conversationsService = {
      getConversation: jest.fn().mockResolvedValue(makeConversation()),
      escalateConversation: jest
        .fn()
        .mockResolvedValue(
          makeConversation({ status: ConversationStatus.ESCALATED }),
        ),
    };
    messagesService = {
      sendAiMessage: jest.fn().mockResolvedValue({ id: 'message-ai-1' }),
      listMessages: jest.fn().mockResolvedValue([]),
    };
    tenantSettings = {
      getSettings: jest.fn().mockResolvedValue(makeSettings()),
    };
    salonProfile = { getProfile: jest.fn().mockResolvedValue(makeProfile()) };
    llm = { complete: jest.fn() };

    orchestrator = new ConversationOrchestratorService(
      aiContext as unknown as AiContextService,
      promptBuilder as unknown as PromptBuilderService,
      toolExecutor as unknown as ToolExecutorService,
      conversationSummary as unknown as ConversationSummaryService,
      conversationsService as unknown as ConversationsService,
      messagesService as unknown as MessagesService,
      tenantSettings as unknown as TenantSettingsService,
      salonProfile as unknown as SalonProfileService,
      llm,
    );
  });

  it('persists the reply and returns it when the model needs no tool calls', async () => {
    llm.complete.mockResolvedValue({
      content: "We're open every day 9-5.",
      toolCalls: [],
      model: 'gpt-4o-mini',
    });

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'What are your hours?',
      persist: true,
    });

    expect(result.replyText).toBe("We're open every day 9-5.");
    expect(result.degraded).toBe(false);
    expect(messagesService.sendAiMessage).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        conversationId: 'conversation-1',
        body: "We're open every day 9-5.",
        promptVersion: 'system-prompt@v1',
      }),
    );
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, feeds the result back, and returns the final reply', async () => {
    toolExecutor.checkAvailability.mockResolvedValue({
      slots: [
        { employeeId: 'e1', employeeName: 'Ana', startTime: 'x', endTime: 'y' },
      ],
    });
    llm.complete
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'checkAvailability',
            arguments: {
              serviceId: 's1',
              dateFrom: '2026-08-03',
              dateTo: '2026-08-03',
            },
          },
        ],
        model: 'gpt-4o-mini',
      })
      .mockResolvedValueOnce({
        content: 'We have Ana free that day.',
        toolCalls: [],
        model: 'gpt-4o-mini',
      });

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'Anything free Saturday?',
      persist: true,
    });

    expect(toolExecutor.checkAvailability).toHaveBeenCalledWith('tenant-1', {
      serviceId: 's1',
      employeeId: undefined,
      dateFrom: '2026-08-03',
      dateTo: '2026-08-03',
    });
    expect(result.replyText).toBe('We have Ana free that day.');
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0].tool).toBe('checkAvailability');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('regenerates the conversation summary when escalateToHuman is called', async () => {
    llm.complete
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'escalateToHuman',
            arguments: { reason: 'Upset customer.' },
          },
        ],
        model: 'gpt-4o-mini',
      })
      .mockResolvedValueOnce({
        content: "I'm connecting you with our team now.",
        toolCalls: [],
        model: 'gpt-4o-mini',
      });

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'I want to speak to a human!',
      persist: true,
    });

    expect(toolExecutor.escalateToHuman).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'Upset customer.',
    );
    expect(conversationSummary.regenerate).toHaveBeenCalled();
    expect(result.toolCallsExecuted.map((c) => c.tool)).toContain(
      'escalateToHuman',
    );
  });

  it('falls back gracefully and auto-escalates when the LLM provider is unavailable', async () => {
    llm.complete.mockRejectedValue(
      new LlmProviderUnavailableException(new Error('timeout')),
    );

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'Book me a haircut.',
      persist: true,
    });

    expect(result.degraded).toBe(true);
    expect(result.replyText).toContain('experiencing an issue');
    expect(conversationsService.escalateConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'AI provider unavailable.',
      ActorType.SYSTEM,
    );
    expect(messagesService.sendAiMessage).not.toHaveBeenCalled();
  });

  it('immediately escalates without calling the LLM when AI is disabled for the tenant', async () => {
    tenantSettings.getSettings.mockResolvedValue(
      makeSettings({ enabled: false }),
    );

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'Hello?',
      persist: true,
    });

    expect(result.degraded).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(conversationsService.escalateConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'AI receptionist is disabled for this tenant.',
      ActorType.SYSTEM,
    );
  });

  it('auto-escalates after the same reply repeats past the configured threshold', async () => {
    aiContext.getContext.mockResolvedValue({
      id: 'ctx-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      currentIntent: null,
      state: {
        lastAiReply: 'Could you clarify which service you mean?',
        repeatedReplyCount: 1,
      },
      lastToolCall: null,
      updatedAt: new Date(),
    });
    tenantSettings.getSettings.mockResolvedValue(
      makeSettings({ confidenceThreshold: 2 }),
    );
    llm.complete.mockResolvedValue({
      content: 'Could you clarify which service you mean?',
      toolCalls: [],
      model: 'gpt-4o-mini',
    });

    await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'hmm not sure',
      persist: true,
    });

    expect(conversationsService.escalateConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'Repeated clarification loop detected.',
      ActorType.AI,
    );
  });

  it('never persists a message or executes a real tool in dashboard-test (dry-run) mode', async () => {
    llm.complete
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'bookAppointment',
            arguments: { startTime: '2026-08-03T14:00:00Z', services: [] },
          },
        ],
        model: 'gpt-4o-mini',
      })
      .mockResolvedValueOnce({
        content: 'Booked! (this is a test)',
        toolCalls: [],
        model: 'gpt-4o-mini',
      });

    const result = await orchestrator.runTurn({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      message: 'Book me a haircut Saturday at 2pm.',
      persist: false,
    });

    expect(messagesService.sendAiMessage).not.toHaveBeenCalled();
    expect(toolExecutor.book).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted[0].result).toMatchObject({
      simulated: true,
    });
    expect(result.messageId).toBeNull();
  });
});
