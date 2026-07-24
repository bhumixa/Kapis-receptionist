# TOOLS.md

## AI Tool Contract (Milestone 8)

Companion to [docs/AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) and [docs/adr/ADR-011-ai-receptionist.md](adr/ADR-011-ai-receptionist.md). Each tool below is a JSON-Schema function definition the model sees (`backend/src/modules/ai/application/tool-definitions.ts`) plus the real service call `ToolExecutorService` makes when the model invokes it (`backend/src/modules/ai/application/tool-executor.service.ts`). Every tool re-validates its arguments against real tenant data — the model's output is treated as untrusted input, never a trusted command (SYSTEM_ARCHITECTURE.md §5.9).

**Identity injection rule**: no schema below exposes `tenantId`, `customerId`, or `conversationId` as a model-supplied argument. All three are always injected by `ConversationOrchestratorService.dispatchTool` from the real, already-resolved conversation record — the model cannot address a tool call at an arbitrary tenant or customer no matter what it outputs.

**Two callers, one implementation**: `ConversationOrchestratorService` calls `ToolExecutorService` in-process for real conversational turns (catching any thrown exception and feeding it back to the model as a structured tool result, SYSTEM_ARCHITECTURE.md §5.10). The `POST /ai/tools/*` HTTP controllers (`book`/`reschedule`/`cancel`/`faq` only — see below) call the exact same methods and let exceptions propagate as real HTTP errors instead — a QA/eval-suite-facing surface, not the production path (ADR-011).

---

## `checkAvailability`

**Underlying call:** `AvailabilityService.getAvailableSlots` (Milestone 6, unchanged). **HTTP endpoint:** none — read-only enough that the testable-surface rationale doesn't apply; called only in-process.

**Model-visible parameters:** `serviceId` (required), `employeeId` (optional — omit to check all eligible staff), `dateFrom`/`dateTo` (required, `YYYY-MM-DD`, max 31-day range).

**Result:** `{ slots: [{ employeeId, employeeName, startTime, endTime }] }` (ISO-8601 timestamps).

**Guardrails:** an unknown `serviceId` throws `ServiceNotFoundForAvailabilityException`; an over-31-day range throws `DateRangeTooLargeException` — both pre-existing Milestone 6 guardrails, unmodified.

---

## `bookAppointment`

**Underlying call:** `AppointmentsService.createAppointmentForAi` (new this milestone — see ADR-011). **HTTP endpoint:** `POST /ai/tools/book` (internal-service credential, `Idempotency-Key` required, `201 Created`).

**Model-visible parameters:** `startTime` (ISO-8601), `services` (array of `{ serviceId, employeeId }`, in performed order), `notes` (optional). `customerId` is **not** a model parameter — injected from `Conversation.customerId`.

**Result:** `{ appointmentId, status, startTime, endTime, totalPriceCents, currency }`.

**Guardrails:** the exact same two-layer booking-conflict-prevention mechanism every human booking goes through (Redis lock + database `EXCLUDE` constraint, docs/SCHEDULING_ARCHITECTURE.md §3) — a race with another booking (human or AI) resolves identically either way. A hallucinated `serviceId`/`employeeId` throws `InvalidServiceReferenceException`/`InvalidEmployeeReferenceException`; a customer belonging to a different tenant throws `InvalidCustomerReferenceException` (verified directly in `test/integration/ai/tenant-isolation.integration-spec.ts`). **Prompt-level guardrail**: the system prompt instructs the model to obtain explicit confirmation before calling this tool (docs/PROMPT_ENGINEERING.md §5) — not server-enforced, since the server has no way to verify a natural-language "yes" occurred; the server-side guarantee is correctness of the booking *if* called, not gating whether it's called.

---

## `rescheduleAppointment`

**Underlying call:** `AppointmentsService.rescheduleAppointmentForAi`. **HTTP endpoint:** `POST /ai/tools/reschedule` (internal-service credential, `Idempotency-Key` required, `200 OK`).

**Model-visible parameters:** `appointmentId`, `newStartTime` (ISO-8601), `services` (optional — omit to keep the existing service/staff assignment).

**Result:** the new appointment's shape (as `bookAppointment`) plus `warnings` (e.g. a late-notice-cancellation-policy warning, unchanged from the Milestone 6 human path).

**Guardrails:** same conflict-prevention/reference-validation as `bookAppointment`; an appointment belonging to a different tenant, or already in a terminal status, resolves identically to the human path (`404`/`TenantResourceNotFoundException`, `InvalidStatusTransitionException`).

---

## `cancelAppointment`

**Underlying call:** `AppointmentsService.cancelAppointmentForAi`. **HTTP endpoint:** `POST /ai/tools/cancel` (internal-service credential, `Idempotency-Key` required, `200 OK`).

**Model-visible parameters:** `appointmentId`, `reason` (optional — the customer's stated reason, if given).

**Result:** `{ appointmentId, status, warnings }`.

**Guardrails:** identical status-transition/tenant-ownership checks as the human cancel path.

---

## `recommendService`

**Underlying call:** `ServiceService.listServices` (Milestone 5, unchanged), filtered to `isActive: true`. **HTTP endpoint:** none — read-only, in-process only.

**Model-visible parameters:** `q` (optional free-text search, e.g. `"haircut"`).

**Result:** `{ services: [{ id, name, description, durationMinutes, priceCents, currency }] }` — active services only, so the model can never recommend a discontinued service.

---

## `answerFaq`

**Underlying call:** grounds on `SalonProfileService.getProfile` + `BusinessHoursService.getBusinessHours` + `ServiceService.listServices` (active only), then makes its **own** narrow internal `LlmProviderPort.complete()` call using the `faq-answering` prompt (docs/PROMPT_ENGINEERING.md) — the one tool that synthesizes natural language internally rather than returning raw data for the outer conversation loop to phrase, since the `POST /ai/tools/faq` HTTP contract must return a ready-to-send `answer` string on its own. **HTTP endpoint:** `POST /ai/tools/faq` (internal-service credential, no side effect, no `Idempotency-Key` needed, `200 OK`).

**Model-visible parameters:** `question` (the customer's literal question).

**Result:** `{ answer, groundedOn: ["SalonProfile", "BusinessHours", "Service"], promptVersion }`.

**Guardrails:** if the inner completion returns empty/no content (the grounded data genuinely doesn't answer the question), throws `GuardrailRejectedException` → `422 GUARDRAIL_REJECTED` — the tool must not fabricate an answer, matching API_SPECIFICATION.md §12's documented contract exactly.

---

## `escalateToHuman`

**Underlying call:** `ConversationsService.escalateConversation` (new this milestone). **HTTP endpoint:** none — always available to the model as an in-process tool; there is no separate `POST /ai/tools/escalate` (the endpoint list API_SPECIFICATION.md §12 documents doesn't include one — escalation is reachable through the conversational loop itself, and through `PATCH /conversations/:id` for a staff-initiated status change).

**Model-visible parameters:** `reason` (required — recorded verbatim as `Conversation.escalationReason`).

**Result:** `{ conversationId, status: "ESCALATED" }`.

**Effect:** `Conversation.status → ESCALATED`, `escalatedAt`/`escalationReason` set, an `AuditLog` entry (`CONVERSATION_ESCALATED`, `actorType: AI`), and — from that point on — `InboundMessageProcessorService` will not invoke the AI on this conversation again until a staff member changes its status (docs/AI_ARCHITECTURE.md §5). Always available to the model; the system prompt names the specific triggers (explicit request, complaint, out-of-scope request, repeated misunderstanding — docs/PROMPT_ENGINEERING.md §5).

---

## Error Shape Fed Back to the Model

Every tool-call failure inside the conversational loop (as opposed to the standalone HTTP surface) is caught by `ConversationOrchestratorService.dispatchTool` and returned as a plain JSON object appended as a `role: 'tool'` message — never a thrown exception reaching the customer:

```json
{ "error": "TOOL_EXECUTION_FAILED", "message": "<the underlying exception's message>" }
```

The system prompt instructs the model to treat any `error` field as a signal to offer an alternative or escalate — never to retry the identical call, never to apologize with a raw error string.
