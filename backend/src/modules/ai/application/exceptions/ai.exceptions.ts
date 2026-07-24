import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as `modules/
 * appointments/application/exceptions/appointment.exceptions.ts`) — the
 * global exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const AI_ERROR_CODES = {
  GUARDRAIL_REJECTED: 'GUARDRAIL_REJECTED',
} as const;

/**
 * SYSTEM_ARCHITECTURE.md 5.9's hallucination-prevention guardrail, made
 * concrete: every tool re-validates the model's arguments against real
 * tenant data before executing (a hallucinated `serviceId`, a `FAQ`
 * question with no grounded answer, an `employeeId` that doesn't belong to
 * this tenant). The model's output is treated as untrusted input, never a
 * trusted command — this is the single exception type every tool-execution
 * failure surfaces as, letting `ConversationOrchestratorService` handle it
 * uniformly (relay a graceful clarifying response to the customer, per
 * SYSTEM_ARCHITECTURE.md 5.10, never a raw error).
 */
export class GuardrailRejectedException extends UnprocessableEntityException {
  constructor(reason: string, details: Record<string, unknown> = {}) {
    super({
      code: AI_ERROR_CODES.GUARDRAIL_REJECTED,
      message: reason,
      details: [details],
    });
  }
}
