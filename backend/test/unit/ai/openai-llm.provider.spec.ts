import { ConfigService } from '@nestjs/config';
import { APIError } from 'openai';
import {
  LlmProviderUnavailableException,
  OpenAiLlmProvider,
} from '../../../src/modules/ai/infrastructure/openai-llm.provider';

function makeConfigService(
  overrides: Record<string, unknown> = {},
): jest.Mocked<Pick<ConfigService, 'getOrThrow' | 'get'>> {
  const values: Record<string, unknown> = {
    'ai.openaiApiKey': 'sk-test-key-1234567890',
    'ai.openaiModel': 'gpt-4o-mini',
    'ai.requestTimeoutMs': 8000,
    'ai.maxRetries': 2,
    'ai.openaiBaseUrl': null,
    ...overrides,
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
    get: jest.fn((key: string) => values[key]),
  } as unknown as jest.Mocked<Pick<ConfigService, 'getOrThrow' | 'get'>>;
}

function makeChatCompletion(content: string | null, toolCalls: unknown[] = []) {
  return {
    model: 'gpt-4o-mini',
    choices: [
      {
        message: {
          content,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

describe('OpenAiLlmProvider', () => {
  let provider: OpenAiLlmProvider;
  let createMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiLlmProvider(
      makeConfigService() as unknown as ConfigService,
    );
    provider.onModuleInit();
    createMock = jest.fn();
    // Private field injection — the SDK client itself is not DI-managed
    // (see the class's own doc comment on why retry is handled explicitly
    // here rather than via the SDK), so this is the natural seam to mock.
    (provider as unknown as { client: unknown }).client = {
      chat: { completions: { create: createMock } },
    };
  });

  it('returns the final natural-language reply with no tool calls', async () => {
    createMock.mockResolvedValue(makeChatCompletion('Hello there!'));

    const result = await provider.complete({
      systemPrompt: 'You are a receptionist.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    expect(result.content).toBe('Hello there!');
    expect(result.toolCalls).toEqual([]);
    expect(result.model).toBe('gpt-4o-mini');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('parses function tool calls, including malformed JSON arguments as an empty object', async () => {
    createMock.mockResolvedValue(
      makeChatCompletion(null, [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'checkAvailability',
            arguments: '{"serviceId":"s1"}',
          },
        },
        {
          id: 'call_2',
          type: 'function',
          function: { name: 'escalateToHuman', arguments: 'not-json' },
        },
      ]),
    );

    const result = await provider.complete({
      systemPrompt: 'sys',
      messages: [],
      tools: [],
    });

    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'checkAvailability',
        arguments: { serviceId: 's1' },
      },
      { id: 'call_2', name: 'escalateToHuman', arguments: {} },
    ]);
  });

  it('retries a transient (5xx) error up to the configured limit, then succeeds', async () => {
    createMock
      .mockRejectedValueOnce(new APIError(500, {}, 'server error', undefined))
      .mockResolvedValueOnce(makeChatCompletion('recovered'));

    const result = await provider.complete({
      systemPrompt: 'sys',
      messages: [],
      tools: [],
    });

    expect(result.content).toBe('recovered');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws LlmProviderUnavailableException after exhausting retries on a transient error', async () => {
    createMock.mockRejectedValue(
      new APIError(503, {}, 'unavailable', undefined),
    );

    await expect(
      provider.complete({ systemPrompt: 'sys', messages: [], tools: [] }),
    ).rejects.toBeInstanceOf(LlmProviderUnavailableException);
    // maxRetries: 2 -> 3 total attempts (initial + 2 retries).
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient (4xx) error', async () => {
    createMock.mockRejectedValue(
      new APIError(400, {}, 'bad request', undefined),
    );

    await expect(
      provider.complete({ systemPrompt: 'sys', messages: [], tools: [] }),
    ).rejects.toBeInstanceOf(LlmProviderUnavailableException);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
