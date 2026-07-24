# AI_ARCHITECTURE.md

## AI Receptionist — Implementation Reference (Milestone 8)

Decision record: [docs/adr/ADR-011-ai-receptionist.md](adr/ADR-011-ai-receptionist.md). Companion docs: [docs/PROMPT_ENGINEERING.md](PROMPT_ENGINEERING.md) (prompt template structure and versioning), [docs/TOOLS.md](TOOLS.md) (the tool contract each tool exposes to the model). For the transport layer this module sits on top of, see [docs/WHATSAPP_ARCHITECTURE.md](WHATSAPP_ARCHITECTURE.md)/[docs/MESSAGING_ARCHITECTURE.md](MESSAGING_ARCHITECTURE.md).

---

## 1. What Exists Now

- `ConversationOrchestratorService` — the AI module's entry point: assembles grounded context, runs the OpenAI tool-calling loop, persists the reply, updates working memory.
- Seven tools (SYSTEM_ARCHITECTURE.md §5.3): `checkAvailability`, `bookAppointment`, `rescheduleAppointment`, `cancelAppointment`, `recommendService`, `answerFaq`, `escalateToHuman` — every one a thin wrapper over an *existing* module service (`AvailabilityService`, `AppointmentsService`'s new `*ForAi` methods, `ServiceService`, `SalonProfileService`/`BusinessHoursService`, `ConversationsService`), never a duplicated implementation.
- `LlmProviderPort`/`OpenAiLlmProvider` — a provider-agnostic abstraction with retry, timeout, and single-exception-type failure handling.
- `AIContext` (durable working memory, Redis-cached), `ConversationSummary` (deterministic digest, regenerated at escalation), `PromptVersion` (ops registry).
- `POST /ai/chat` (dual-mode: internal-service credential or `MANAGER`+ JWT for the dashboard "Test my AI" sandbox), `POST /ai/tools/{book,reschedule,cancel,faq}` (internal-service only, the QA/eval/observability HTTP surface — real production traffic runs in-process, see §3), `GET /ai/context/:conversationId` and `GET /ai/prompt-versions` (STAFF-readable, back the frontend debug panel and Prompt Management UI).
- `PATCH /conversations/:id/assign` (new this milestone) — the human-takeover action.
- Human hand-off: `ConversationStatus.ESCALATED`, `Conversation.escalatedAt`/`.escalationReason`.
- A per-tenant `POST /ai/chat` rate limit (`AiRateLimitGuard`, 30 req/min default, `AI_RATE_LIMIT_PER_MINUTE`).

Not built: streaming responses (no SSE/WebSocket transport exists anywhere in this codebase — see §6), plan-based usage limiting (needs `Subscription`, Milestone 9), voice/non-WhatsApp channels (explicitly out of scope), a true model-reported confidence score (OpenAI's Chat Completions API doesn't expose one — see §5's repeated-reply proxy).

---

## 2. Data Model

### `AIContext` (1:1 with `Conversation`)

```
id, tenantId, conversationId (unique), currentIntent (nullable), state
(JSONB, default {}), lastToolCall (nullable), updatedAt
```

Durable per-conversation working memory (SYSTEM_ARCHITECTURE.md §5.2/§5.5) — e.g. "customer is mid-booking-flow, selected service X, awaiting time confirmation," plus the repeated-clarification-loop tracking (`state.lastAiReply`/`state.repeatedReplyCount`, §5). Cached in Redis (`ai:context:{conversationId}`, ~6h TTL, refreshed every turn, per DATABASE_DESIGN.md §10.2's documented design) — the cache is a pure latency optimization; a miss always falls back to and repopulates from this table.

### `ConversationSummary` (1:1 with `Conversation`)

```
id, tenantId, conversationId (unique), summaryText, messageCount,
lastCustomerIntent (nullable), generatedAt, aiPromptVersion (nullable)
```

A deterministic digest of message history (concatenated, truncated — not an LLM call), regenerated only at natural checkpoints (currently: escalation) rather than on every turn, per SYSTEM_ARCHITECTURE.md §5.7's token/cost-optimization goal. Explicitly a derived/cache record, always regeneratable, never authoritative.

### `PromptVersion` (global registry, not tenant-owned)

```
id, key, version, description (nullable), isActive, releasedAt
(nullable), createdAt
```

**Not** prompt content — an ops/debugging registry answering "which version of this named prompt is currently active," self-registered by `PromptBuilderService.onModuleInit()` on every boot from the versioned files under `modules/ai/prompts/` (see PROMPT_ENGINEERING.md). `Message.aiPromptVersion`/`ConversationSummary.aiPromptVersion` store a plain `"{key}@{version}"` string, not a foreign key — decoupling the high-write `messages` table from this registry's lifecycle.

### `Conversation` (additive columns)

```
..., escalatedAt (nullable), escalationReason (nullable, VARCHAR 255)
```

### `Message` (additive column)

```
..., aiPromptVersion (nullable, VARCHAR 50)
```

### `ConversationStatus` (additive enum value)

`OPEN | ESCALATED | RESOLVED | CLOSED` — see ADR-011 for the narrowing rationale (no `OPEN_AI`/`HUMAN_HANDLING`; `Conversation.assignedUserId` distinguishes queued-unclaimed from claimed).

### `TenantSettings.general.ai` (application-layer namespace — no schema column)

```json
{
  "enabled": true,
  "tone": "friendly and professional",
  "greetingMessage": "",
  "escalationInstructions": "",
  "fallbackMessage": "",
  "confidenceThreshold": 2
}
```

Read/written through the existing `TenantSettingsService` — see ADR-011 for why this needed no migration.

---

## 3. Conversation Flow

```
Real WhatsApp message (production path):
  Meta → WhatsApp webhook → WhatsAppInboundProcessor (BullMQ)
    → InboundMessageProcessorService.processInboundMessage
        → persists inbound Message (senderType: CUSTOMER), as before Milestone 8
        → triggerAiResponse(tenantId, conversation, content):
            skip if conversation.status === ESCALATED, or content is empty
            → ConversationOrchestratorService.runTurn({ persist: true })
                [in-process provider call — no HTTP hop]

Dashboard "Test my AI" / QA / eval (secondary path):
  POST /ai/chat (channel: "whatsapp" | "dashboard_test")
    → AiChatAuthGuard (internal-service credential OR MANAGER+ JWT)
    → ConversationOrchestratorService.runTurn({ persist: channel === "whatsapp" })
```

`runTurn`:

1. Loads the tenant's `general.ai` settings and salon profile; if `enabled: false`, escalates immediately (`ActorType.SYSTEM`) and returns the fallback message without calling the model.
2. Builds a bounded recent-message-history window (`AI_MAX_HISTORY_MESSAGES`, default 20 — never the full conversation, SYSTEM_ARCHITECTURE.md §5.2/§5.7) and the current `AIContext` state.
3. Assembles the system prompt (`PromptBuilderService`, see PROMPT_ENGINEERING.md) and calls `LlmProviderPort.complete()` with the fixed tool set (TOOLS.md).
4. If the model requests tool calls: dispatches each (real execution when `persist: true`; a `{ simulated: true }` stub when `persist: false` — dashboard-test mode never executes a real booking/escalation), feeds every result back as a `role: 'tool'` message, and calls the model again — bounded to `MAX_TOOL_ROUNDS` (3) to prevent a runaway loop.
5. Persists the final reply via `MessagesService.sendAiMessage` (only when `persist: true`) — `senderType: AI`, `aiPromptVersion` recorded, enqueued onto the existing `whatsapp-outbound` queue exactly like a staff reply.
6. Updates `AIContext` (current intent, last tool call, repeated-reply tracking) and, if the turn escalated, regenerates the `ConversationSummary`.

On an `LlmProviderUnavailableException` from any step, the whole turn short-circuits to the tenant's fallback message + auto-escalation (`ActorType.SYSTEM`) — see §5.

---

## 4. Guardrails (SYSTEM_ARCHITECTURE.md §5.9)

- **Grounding, not memorization**: `answerFaq`/`recommendService`/`checkAvailability` always read live data (`SalonProfileService`, `BusinessHoursService`, `ServiceService`, `AvailabilityService`) — the model is never asked to recall a price, duration, or availability slot from earlier in the conversation.
- **Structured Outputs**: every tool call is a JSON-Schema-constrained function call (TOOLS.md); only the final natural-language reply is free text.
- **Server-side re-validation**: every tool re-validates the model's arguments against real tenant data before executing — a hallucinated `serviceId`/`employeeId`/`appointmentId` throws (`InvalidServiceReferenceException`, `TenantResourceNotFoundException`, etc., or the AI module's own `GuardrailRejectedException` for `answerFaq`'s "no grounded answer" case), caught by the orchestrator and fed back to the model as a structured failure — never a raw error reaching the customer.
- **Confirmation before booking**: enforced at the prompt level (PROMPT_ENGINEERING.md's system prompt hard rules) — the model is instructed to summarize and get explicit confirmation before calling `bookAppointment`/`rescheduleAppointment`/`cancelAppointment`. This is a prompt-level control, not a server-side state machine; see PROMPT_ENGINEERING.md for the exact wording and its rationale.
- **No hallucinated identity**: `customerId`/`conversationId`/`tenantId` are never taken from the model's tool-call arguments — always injected by the orchestrator from the real, already-resolved conversation record (TOOLS.md).

---

## 5. Fallback & Escalation (SYSTEM_ARCHITECTURE.md §5.10, §5.8)

- **Provider unavailable**: `OpenAiLlmProvider` retries transient errors (5xx/429/connection errors, bounded by `AI_MAX_RETRIES`, exponential backoff) before throwing `LlmProviderUnavailableException`. The orchestrator catches this exactly once per turn, returns the tenant's `fallbackMessage` (or a sensible default), and auto-escalates (`ActorType.SYSTEM`, reason `"AI provider unavailable."`) — verified live in a real browser against a real running backend with an intentionally invalid `OPENAI_API_KEY` (see ADR-011's Consequences).
- **Tool execution failure**: caught per-call, returned to the model as a structured `{ error, message }` tool result — the system prompt instructs the model to offer alternatives or escalate gracefully rather than repeat the failed action verbatim.
- **Repeated-clarification loop**: no true model-confidence score is available from the Chat Completions API (a documented, deliberate scoping — ADR-011), so `AIContext.state` tracks exact-repeat AI replies; past `general.ai.confidenceThreshold` (default 2) consecutive identical replies, the orchestrator auto-escalates (`ActorType.AI`, reason `"Repeated clarification loop detected."`).
- **Explicit escalation**: the `escalateToHuman` tool is always available to the model (TOOLS.md) and is the correct response to an explicit human request, a complaint, or a request outside the other six tools.
- **After escalation**: `InboundMessageProcessorService` checks `conversation.status === ESCALATED` before ever invoking the orchestrator — the AI does not auto-respond again on that thread until a staff member resolves/reopens it (`PATCH /conversations/:id`) or the status otherwise changes.

---

## 6. Streaming

Not implemented. No SSE/WebSocket transport exists anywhere in this codebase (frontend or backend) — `LlmProviderPort.complete()` is a single non-streaming request/response method. The interface is deliberately shaped so a future `completeStream()` method wouldn't require redesigning the port, but no transport-level streaming is built or exposed this milestone. Flagged here explicitly, not a silent gap.

---

## 7. Files

**Backend, new:**
```
backend/src/modules/ai/
  domain/entities/{ai-context,conversation-summary,prompt-version}.entity.ts
  domain/ports/{ai-context,conversation-summary,prompt-version}-repository.port.ts
  domain/ports/llm-provider.port.ts
  application/{conversation-orchestrator,tool-executor,prompt-builder,
    ai-context,conversation-summary,prompt-version}.service.ts
  application/tool-definitions.ts
  application/exceptions/ai.exceptions.ts
  infrastructure/prisma-{ai-context,conversation-summary,prompt-version}.repository.ts
  infrastructure/openai-llm.provider.ts
  infrastructure/mappers/prisma-ai.mappers.ts
  interface/{ai-chat,ai-tools,ai-dashboard}.controller.ts
  interface/ai-rate-limit.guard.ts
  interface/dto/*.dto.ts
  prompts/{system-prompt,faq-answering,escalation-instructions}.v1.md
  ai.module.ts

backend/src/core/guards/
  internal-service-auth.guard.ts, internal-service-auth.util.ts,
  internal-service-auth.exceptions.ts, ai-chat-auth.guard.ts

backend/test/unit/ai/**, backend/test/unit/core/{internal-service-auth,ai-chat-auth}.guard.spec.ts
backend/test/integration/ai/**, backend/test/integration/support/ai-fixtures.ts
```

**Backend, modified:**
```
backend/prisma/schema.prisma (+3 models, +2 Conversation columns,
  +1 Message column, +1 enum value), +migration
backend/prisma/seed.ts (+ai:manage)
backend/src/config/{env.validation,configuration,config.module}.ts (+AI/OpenAI env vars)
backend/src/modules/appointments/application/appointments.service.ts (+3 *ForAi methods)
backend/src/modules/appointments/domain/ports/appointment-repository.port.ts (actorType/actorId widened)
backend/src/modules/appointments/infrastructure/prisma-appointment.repository.ts
backend/src/modules/appointments/appointments.module.ts (+export AppointmentsService)
backend/src/modules/whatsapp/application/conversations.service.ts (+escalateConversation)
backend/src/modules/whatsapp/application/messages.service.ts (+sendAiMessage)
backend/src/modules/whatsapp/application/inbound-message-processor.service.ts (+AI hand-off)
backend/src/modules/whatsapp/domain/{entities,ports}/* (+escalate, +aiPromptVersion)
backend/src/modules/whatsapp/interface/conversations.controller.ts (+PATCH :id/assign)
backend/src/modules/whatsapp/whatsapp.module.ts (+forwardRef AiModule)
backend/src/modules/salon/salon.module.ts (+export SalonProfileService)
backend/src/common/utils/json-settings.util.ts (+string/boolean/object readers)
backend/src/app.module.ts (+AiModule)
backend/nest-cli.json (+assets), backend/tsconfig.build.json (+rootDir fix), backend/package.json (+openai)
```

**Frontend, new:**
```
frontend/src/app/shared/models/ai.model.ts
frontend/src/app/core/api/ai-api.service.ts
```

**Frontend, modified:**
```
frontend/src/app/shared/models/whatsapp.model.ts (+ESCALATED, +escalation fields, +aiPromptVersion)
frontend/src/app/core/api/conversations-api.service.ts (+assignUser)
frontend/src/app/shared/constants/role-permissions.constant.ts (+ai:manage)
frontend/src/app/features/conversations/pages/conversations-inbox-page/* (status filter,
  senderType styling, take-over/unassign, AI debug panel)
frontend/src/app/features/settings/pages/settings-page/* (AI Behavior form, prompt
  versions table, Test my AI sandbox)
```

---

## 8. Deferred / Known Gaps (Not Forgotten)

- **Streaming** — no transport exists; see §6.
- **Plan-based usage limiting** (`403 PLAN_MESSAGE_LIMIT_EXCEEDED`) — needs `Subscription`, Milestone 9.
- **True model-confidence-based escalation** — OpenAI's Chat Completions API exposes no per-turn confidence score; the repeated-exact-reply counter (§5) is the deliberate, documented proxy.
- **`customerPhoneNumber`-based conversation resolution on `POST /ai/chat`** — not built; the endpoint requires an already-resolved `conversationId`, matching the in-process production path's own precondition. A narrowing from API_SPECIFICATION.md's original draft, logged here per this codebase's standing convention.
- **Voice, SMS, or any non-WhatsApp channel** — explicitly out of scope per this milestone's brief.
