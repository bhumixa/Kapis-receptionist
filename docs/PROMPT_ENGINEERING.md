# PROMPT_ENGINEERING.md

## Prompt Templates & Versioning (Milestone 8)

Companion to [docs/AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) and [docs/adr/ADR-011-ai-receptionist.md](adr/ADR-011-ai-receptionist.md). Scope: how prompts are authored, versioned, and interpolated with tenant data — not the tool contract (see [docs/TOOLS.md](TOOLS.md)).

---

## 1. Prompts Are Source-Controlled Files, Not Database Content

Per SYSTEM_ARCHITECTURE.md §5.1, prompt content lives in versioned markdown files under `backend/src/modules/ai/prompts/`, read once at boot (`PromptBuilderService.onModuleInit`) and held in memory — never edited through the dashboard, never stored as freeform text in the database. The `PromptVersion` table (docs/AI_ARCHITECTURE.md §2) is a **registry, not a CMS**: it records which version of each named prompt is currently active (for the Settings page's read-only Prompt Versions table and for post-hoc debugging — "this bad booking happened under prompt v3," SYSTEM_ARCHITECTURE.md §5.6), self-registered from the files on every boot.

This is a deliberate security/product decision, not an oversight: a tenant-editable raw prompt would reopen exactly the prompt-injection-through-configuration risk §5.1 already flags. Tenant customization is always injected as **structured variables** into a fixed base template — a tenant can change the greeting text or the tone description, never the model's actual instructions.

## 2. The Three Templates

| File | Key | Purpose |
|---|---|---|
| `system-prompt.v1.md` | `system-prompt` | The base system prompt for every conversational turn — identity, tone, hard rules, current conversation state. |
| `faq-answering.v1.md` | `faq-answering` | A narrow, single-purpose prompt used only inside the `answerFaq` tool's own internal LLM call (docs/TOOLS.md) — grounds strictly on supplied salon/business-hours/service data. |
| `escalation-instructions.v1.md` | `escalation-instructions` | A composable fragment — only rendered (and spliced into the system prompt's `{{escalationInstruction}}` placeholder) when a tenant has configured custom escalation guidance in Settings. |

Each file's filename embeds its version (`{key}.{version}.md`); `PromptBuilderService` reads all three at startup and calls `PromptVersionService.registerActive(key, version, description)` for each — the same self-registering pattern for all three, so adding a fourth template later is additive.

## 3. Versioning Scheme

A prompt's fully-qualified identifier is `{key}@{version}` (e.g. `system-prompt@v1`) — this exact string is what's recorded on `Message.aiPromptVersion`/`ConversationSummary.aiPromptVersion` (plain strings, not foreign keys — see ADR-011 for why). To ship a new prompt version:

1. Add a new file, e.g. `system-prompt.v2.md`, alongside (not replacing) `system-prompt.v1.md`.
2. Update the version constant in `prompt-builder.service.ts` (`SYSTEM_PROMPT_VERSION = 'v2'`) and the file path it reads.
3. Deploy. On boot, `registerActive('system-prompt', 'v2', ...)` marks the new version active and (per `PromptVersionRepositoryPort.registerActive`'s contract) deactivates the previous version's registry row — the old file stays on disk and in git history for reference, but is no longer loaded.

There is no runtime A/B mechanism or staged rollout at this milestone — a version change is an all-tenants deploy, matching this codebase's existing "no per-tenant feature flag infrastructure" posture. If staged rollout becomes a real need, the natural extension point is `PromptBuilderService` reading a tenant-specific override before falling back to the globally active version — not built, not assumed.

## 4. Variable Interpolation

A minimal `{{key}}` template engine (`interpolate()` in `prompt-builder.service.ts`) — no conditionals, no loops, deliberately simple enough to audit at a glance. Unresolved keys render as empty string, never leave a literal `{{...}}` in the output (covered by a unit test).

`buildSystemPrompt` variables:

| Placeholder | Source |
|---|---|
| `{{tenantName}}` | `SalonProfileService.getProfile().name` |
| `{{currentDateTime}}` / `{{tenantTimezone}}` | Server clock (ISO-8601) / `SalonProfileService.getProfile().timezone` |
| `{{tone}}` | `general.ai.tone` (tenant setting, Settings → AI Behavior) |
| `{{greetingInstruction}}` | Derived from `general.ai.greetingMessage`, empty if unset |
| `{{escalationInstruction}}` | The rendered `escalation-instructions.v1.md` fragment, empty if the tenant has no custom instructions configured |
| `{{conversationStateSummary}}` | Derived from `AIContext.currentIntent`/`.state` for this conversation |

`buildFaqPrompt` variables: `{{question}}` (the customer's literal question), `{{groundedData}}` (a formatted text block of salon profile + business hours + active service catalog — see `ToolExecutorService.answerFaq`/`formatGroundedData`).

## 5. The System Prompt's Hard Rules

`system-prompt.v1.md`'s "Hard rules" section is the concrete implementation of SYSTEM_ARCHITECTURE.md §5.9's hallucination-prevention/guardrail requirements, worth stating explicitly since they're prompt-level (not server-enforced) controls:

1. **Never invent facts** — prices, durations, availability, staff names, policies always come from a tool result.
2. **Confirm before booking/rescheduling/cancelling** — summarize and get explicit confirmation before calling a mutating tool. This is the prompt-level half of the confirmation requirement; the server-side half is that every mutating tool still independently re-validates its arguments (docs/TOOLS.md) regardless of what the model claims was confirmed — a prompt instruction is a strong steer, not a security boundary, so the tool layer never trusts it as one.
3. **One clarifying question at a time** — avoids overwhelming an ambiguous request with a wall of options.
4. **Escalate, don't struggle** — explicit triggers: human request, complaint, out-of-scope request, repeated failure to understand.
5. **Stay in character, stay concise** — product/tone requirement, not a safety one.

## 6. Testing Prompt Changes

- `test/unit/ai/prompt-builder.service.spec.ts` — interpolation correctness (no unresolved placeholders, conditional fragments render only when expected), registry self-registration.
- `test/integration/ai/ai-chat.integration-spec.ts` — full conversational turns against a scripted `LlmProviderPort` double (`ScriptedLlmProvider`, `test/integration/support/ai-fixtures.ts`), so prompt/tool-loop regressions surface without spending real OpenAI budget.
- Manual regression: the Settings page's "Test my AI" sandbox (`channel: "dashboard_test"`) — real prompt assembly and (if `OPENAI_API_KEY` is a real key) a real completion, but no real booking/message side effects (docs/AI_ARCHITECTURE.md §3).

No automated eval-set-against-real-OpenAI pipeline exists yet — SYSTEM_ARCHITECTURE.md §1.3/IMPLEMENTATION_ROADMAP.md's Sprint 8.1 risk note (real usage data informing Milestone 9's plan-limit tuning) is an operational activity, not a built system, at this milestone's close.
