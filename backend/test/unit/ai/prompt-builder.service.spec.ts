import { PromptBuilderService } from '../../../src/modules/ai/application/prompt-builder.service';
import { PromptVersionService } from '../../../src/modules/ai/application/prompt-version.service';

describe('PromptBuilderService', () => {
  let promptVersions: jest.Mocked<Pick<PromptVersionService, 'registerActive'>>;
  let service: PromptBuilderService;

  beforeEach(async () => {
    promptVersions = { registerActive: jest.fn().mockResolvedValue(undefined) };
    service = new PromptBuilderService(
      promptVersions as unknown as PromptVersionService,
    );
    await service.onModuleInit();
  });

  it('registers all three template versions on init', () => {
    expect(promptVersions.registerActive).toHaveBeenCalledWith(
      'system-prompt',
      'v1',
      expect.any(String),
    );
    expect(promptVersions.registerActive).toHaveBeenCalledWith(
      'faq-answering',
      'v1',
      expect.any(String),
    );
    expect(promptVersions.registerActive).toHaveBeenCalledWith(
      'escalation-instructions',
      'v1',
      expect.any(String),
    );
  });

  describe('buildSystemPrompt', () => {
    it('interpolates tenant variables into the base template', () => {
      const { prompt, promptVersion } = service.buildSystemPrompt({
        tenantName: 'Bella Salon',
        tenantTimezone: 'America/Sao_Paulo',
        tone: 'warm and upbeat',
        greetingMessage: 'Welcome to Bella Salon!',
        escalationInstructions: null,
        conversationStateSummary: null,
      });

      expect(prompt).toContain('Bella Salon');
      expect(prompt).toContain('warm and upbeat');
      expect(prompt).toContain('Welcome to Bella Salon!');
      expect(promptVersion).toBe('system-prompt@v1');
    });

    it('never leaves a raw {{placeholder}} unresolved', () => {
      const { prompt } = service.buildSystemPrompt({
        tenantName: 'Bella Salon',
        tenantTimezone: 'UTC',
        tone: 'friendly',
        greetingMessage: null,
        escalationInstructions: null,
        conversationStateSummary: null,
      });

      expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    });

    it('composes the tenant-configured escalation-instructions fragment only when present', () => {
      const withInstructions = service.buildSystemPrompt({
        tenantName: 'Bella Salon',
        tenantTimezone: 'UTC',
        tone: 'friendly',
        greetingMessage: null,
        escalationInstructions: 'Always escalate refund requests.',
        conversationStateSummary: null,
      });
      expect(withInstructions.prompt).toContain(
        'Always escalate refund requests.',
      );

      const withoutInstructions = service.buildSystemPrompt({
        tenantName: 'Bella Salon',
        tenantTimezone: 'UTC',
        tone: 'friendly',
        greetingMessage: null,
        escalationInstructions: null,
        conversationStateSummary: null,
      });
      expect(withoutInstructions.prompt).not.toContain(
        'Additional tenant-configured',
      );
    });
  });

  describe('buildFaqPrompt', () => {
    it('interpolates the question and grounded data', () => {
      const { prompt, promptVersion } = service.buildFaqPrompt(
        'What are your hours?',
        'Business hours:\nMonday: 9:00-17:00',
      );

      expect(prompt).toContain('What are your hours?');
      expect(prompt).toContain('Monday: 9:00-17:00');
      expect(promptVersion).toBe('faq-answering@v1');
    });
  });
});
