import { forwardRef, Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../../core/idempotency/idempotency.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { SalonModule } from '../salon/salon.module';
import { ServicesModule } from '../services/services.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AI_CONTEXT_REPOSITORY } from './domain/ports/ai-context-repository.port';
import { CONVERSATION_SUMMARY_REPOSITORY } from './domain/ports/conversation-summary-repository.port';
import { PROMPT_VERSION_REPOSITORY } from './domain/ports/prompt-version-repository.port';
import { LLM_PROVIDER } from './domain/ports/llm-provider.port';
import { PrismaAiContextRepository } from './infrastructure/prisma-ai-context.repository';
import { PrismaConversationSummaryRepository } from './infrastructure/prisma-conversation-summary.repository';
import { PrismaPromptVersionRepository } from './infrastructure/prisma-prompt-version.repository';
import { OpenAiLlmProvider } from './infrastructure/openai-llm.provider';
import { AiContextService } from './application/ai-context.service';
import { ConversationOrchestratorService } from './application/conversation-orchestrator.service';
import { ConversationSummaryService } from './application/conversation-summary.service';
import { PromptBuilderService } from './application/prompt-builder.service';
import { PromptVersionService } from './application/prompt-version.service';
import { ToolExecutorService } from './application/tool-executor.service';
import { AiChatController } from './interface/ai-chat.controller';
import { AiDashboardController } from './interface/ai-dashboard.controller';
import { AiRateLimitGuard } from './interface/ai-rate-limit.guard';
import { AiToolsController } from './interface/ai-tools.controller';

/**
 * Milestone 8's `AI` module (docs/AI_ARCHITECTURE.md, docs/adr/
 * ADR-011-ai-receptionist.md) — orchestrates the *existing* `Appointments`/
 * `Availability`/`Services`/`Salon`/`Tenants`/`WhatsApp` module services as
 * tools, never duplicating their logic. Real production tool/message
 * execution is in-process (`ConversationOrchestratorService` called
 * directly by `WhatsAppModule`'s `InboundMessageProcessorService`) —
 * `POST /ai/tools/*`/`POST /ai/chat` are a parallel, equally-real HTTP
 * surface for QA/eval/observability, not the production hot path
 * (SYSTEM_ARCHITECTURE.md 5.3, API_SPECIFICATION.md Section 12).
 *
 * `forwardRef(() => WhatsAppModule)`: this module needs `WhatsAppModule`'s
 * `ConversationsService`/`MessagesService`; `WhatsAppModule`'s own
 * `InboundMessageProcessorService` needs this module's
 * `ConversationOrchestratorService` back — a genuine, intentional circular
 * module dependency, the same `forwardRef`-on-both-sides resolution
 * `CoreModule`/`AuthModule`/`TenantsModule`'s existing 3-way cycle already
 * establishes as this codebase's precedent.
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    IdempotencyModule,
    AppointmentsModule,
    AvailabilityModule,
    SalonModule,
    ServicesModule,
    TenantsModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [AiChatController, AiToolsController, AiDashboardController],
  providers: [
    { provide: AI_CONTEXT_REPOSITORY, useClass: PrismaAiContextRepository },
    {
      provide: CONVERSATION_SUMMARY_REPOSITORY,
      useClass: PrismaConversationSummaryRepository,
    },
    {
      provide: PROMPT_VERSION_REPOSITORY,
      useClass: PrismaPromptVersionRepository,
    },
    { provide: LLM_PROVIDER, useClass: OpenAiLlmProvider },
    AiContextService,
    PromptVersionService,
    PromptBuilderService,
    ToolExecutorService,
    ConversationSummaryService,
    ConversationOrchestratorService,
    AiRateLimitGuard,
  ],
  exports: [ConversationOrchestratorService],
})
export class AiModule {}
