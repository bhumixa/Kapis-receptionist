import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../../src/app.module';
import { validationExceptionFactory } from '../../../src/common/pipes/validation-exception-factory';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  LLM_PROVIDER,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProviderPort,
} from '../../../src/modules/ai/domain/ports/llm-provider.port';
import { RbacProbeTestModule } from './rbac-probe/rbac-probe.module';

/**
 * A scriptable `LlmProviderPort` test double — integration tests queue up
 * exactly the completions they want returned (one per `complete()` call,
 * i.e. one per tool-calling round) rather than ever calling the real
 * OpenAI API. `calls` records every request this test double received, so
 * a spec can assert on the system prompt/messages/tools the orchestrator
 * actually built.
 */
export class ScriptedLlmProvider implements LlmProviderPort {
  private queue: Array<LlmCompletionResult | (() => LlmCompletionResult)> = [];
  readonly calls: LlmCompletionRequest[] = [];

  enqueue(result: LlmCompletionResult | (() => LlmCompletionResult)): this {
    this.queue.push(result);
    return this;
  }

  enqueueReply(content: string, promptModel = 'gpt-4o-mini'): this {
    return this.enqueue({ content, toolCalls: [], model: promptModel });
  }

  enqueueToolCall(
    name: string,
    args: Record<string, unknown>,
    id = `call_${Math.random().toString(36).slice(2, 8)}`,
  ): this {
    return this.enqueue({
      content: null,
      toolCalls: [{ id, name, arguments: args }],
      model: 'gpt-4o-mini',
    });
  }

  enqueueRejection(error: Error): this {
    return this.enqueue(() => {
      throw error;
    });
  }

  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error(
        'ScriptedLlmProvider: no more scripted completions queued — the orchestrator called complete() more times than the test expected.',
      );
    }
    return Promise.resolve(typeof next === 'function' ? next() : next);
  }
}

/**
 * Same real-Postgres/Redis/full-`AppModule` bootstrap as `createTestApp()`
 * (`test-app.factory.ts`) — the AI module's own integration specs need one
 * addition: `LLM_PROVIDER` overridden with a `ScriptedLlmProvider` so no
 * test ever calls the real OpenAI API. Returns the app plus the scripted
 * provider so each spec can queue exactly the completions it wants.
 */
export async function createAiTestApp(): Promise<{
  app: INestApplication;
  llm: ScriptedLlmProvider;
}> {
  const llm = new ScriptedLlmProvider();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, RbacProbeTestModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue(llm)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/ready', 'webhooks/whatsapp'],
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  await app.init();
  return { app, llm };
}

export async function seedTenantAiSettings(
  prisma: PrismaService,
  tenantId: string,
  ai: Record<string, unknown>,
): Promise<void> {
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, general: { ai } as Prisma.InputJsonValue },
    update: { general: { ai } as Prisma.InputJsonValue },
  });
}
