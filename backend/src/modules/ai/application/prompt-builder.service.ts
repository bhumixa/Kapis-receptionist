import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PromptVersionService } from './prompt-version.service';

const PROMPTS_DIR = join(__dirname, '..', 'prompts');

const SYSTEM_PROMPT_KEY = 'system-prompt';
const SYSTEM_PROMPT_VERSION = 'v1';
const FAQ_PROMPT_KEY = 'faq-answering';
const FAQ_PROMPT_VERSION = 'v1';
const ESCALATION_INSTRUCTIONS_KEY = 'escalation-instructions';
const ESCALATION_INSTRUCTIONS_VERSION = 'v1';

export interface BuildSystemPromptInput {
  tenantName: string;
  tenantTimezone: string;
  tone: string;
  greetingMessage: string | null;
  escalationInstructions: string | null;
  conversationStateSummary: string | null;
}

export interface BuiltPrompt {
  prompt: string;
  /** `{key}@{version}` — recorded on `Message.aiPromptVersion`/`ConversationSummary.aiPromptVersion` (SYSTEM_ARCHITECTURE.md 5.6). */
  promptVersion: string;
}

/**
 * Assembles the system prompt (SYSTEM_ARCHITECTURE.md 5.1) from versioned,
 * source-controlled template files — never inline strings, never
 * tenant-editable raw prompts (tenant customization is injected as
 * structured variables into the base template, preventing
 * prompt-injection-through-configuration). Templates are read once at
 * startup and held in memory; each is registered into the `PromptVersion`
 * ops registry on load (self-registering, see that port's doc comment).
 */
@Injectable()
export class PromptBuilderService implements OnModuleInit {
  private systemPromptTemplate = '';
  private faqPromptTemplate = '';
  private escalationInstructionsTemplate = '';

  constructor(private readonly promptVersions: PromptVersionService) {}

  async onModuleInit(): Promise<void> {
    [
      this.systemPromptTemplate,
      this.faqPromptTemplate,
      this.escalationInstructionsTemplate,
    ] = await Promise.all([
      readFile(join(PROMPTS_DIR, 'system-prompt.v1.md'), 'utf8'),
      readFile(join(PROMPTS_DIR, 'faq-answering.v1.md'), 'utf8'),
      readFile(join(PROMPTS_DIR, 'escalation-instructions.v1.md'), 'utf8'),
    ]);

    await Promise.all([
      this.promptVersions.registerActive(
        SYSTEM_PROMPT_KEY,
        SYSTEM_PROMPT_VERSION,
        'Base system prompt for the AI receptionist.',
      ),
      this.promptVersions.registerActive(
        FAQ_PROMPT_KEY,
        FAQ_PROMPT_VERSION,
        'FAQ-answering grounding prompt.',
      ),
      this.promptVersions.registerActive(
        ESCALATION_INSTRUCTIONS_KEY,
        ESCALATION_INSTRUCTIONS_VERSION,
        'Tenant-configured escalation-guidance fragment.',
      ),
    ]);
  }

  buildSystemPrompt(input: BuildSystemPromptInput): BuiltPrompt {
    const escalationInstruction = input.escalationInstructions
      ? interpolate(this.escalationInstructionsTemplate, {
          tenantName: input.tenantName,
          escalationInstructions: input.escalationInstructions,
        })
      : '';

    const prompt = interpolate(this.systemPromptTemplate, {
      tenantName: input.tenantName,
      currentDateTime: new Date().toISOString(),
      tenantTimezone: input.tenantTimezone,
      tone: input.tone,
      greetingInstruction: input.greetingMessage
        ? `Open with (or naturally work in) this salon's configured greeting: "${input.greetingMessage}"`
        : '',
      escalationInstruction,
      conversationStateSummary:
        input.conversationStateSummary ??
        'No prior structured state for this conversation yet.',
    });

    return {
      prompt,
      promptVersion: `${SYSTEM_PROMPT_KEY}@${SYSTEM_PROMPT_VERSION}`,
    };
  }

  buildFaqPrompt(question: string, groundedData: string): BuiltPrompt {
    const prompt = interpolate(this.faqPromptTemplate, {
      question,
      groundedData,
    });
    return { prompt, promptVersion: `${FAQ_PROMPT_KEY}@${FAQ_PROMPT_VERSION}` };
  }
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '',
  );
}
