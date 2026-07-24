import type { LlmToolDefinition } from '../domain/ports/llm-provider.port';

/**
 * The fixed, explicit tool set (SYSTEM_ARCHITECTURE.md 5.3) — every schema
 * here is what the model actually sees; `ToolExecutorService`/
 * `ConversationOrchestratorService.dispatchTool` re-validate every argument
 * against real tenant data regardless of what this schema already
 * constrains (5.9's "model output is untrusted input" rule). Deliberately
 * omits `customerId`/`conversationId`/`tenantId` from every schema — those
 * are always injected by the orchestrator from the real conversation
 * record, never taken from the model's tool-call arguments, so the model
 * cannot address a booking action at an arbitrary customer/tenant.
 */
export const TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: 'checkAvailability',
    description:
      'Check real, current appointment availability for a service (optionally for one specific staff member) within a date range. Always call this before proposing a time — never guess a slot.',
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: 'string', description: 'The service catalog id.' },
        employeeId: {
          type: 'string',
          description: 'Optional — restrict to one specific staff member.',
        },
        dateFrom: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        dateTo: {
          type: 'string',
          description: 'YYYY-MM-DD, inclusive, max 31 days after dateFrom.',
        },
      },
      required: ['serviceId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'bookAppointment',
    description:
      'Create a real, confirmed appointment for the customer in this conversation. Only call this after the customer has explicitly confirmed the service, staff member, date, and time.',
    parameters: {
      type: 'object',
      properties: {
        startTime: {
          type: 'string',
          description: 'ISO-8601 start time of the first service line.',
        },
        services: {
          type: 'array',
          description:
            'One or more (serviceId, employeeId) lines, in the order they should be performed.',
          items: {
            type: 'object',
            properties: {
              serviceId: { type: 'string' },
              employeeId: { type: 'string' },
            },
            required: ['serviceId', 'employeeId'],
          },
        },
        notes: {
          type: 'string',
          description: 'Optional free-text note from the customer.',
        },
      },
      required: ['startTime', 'services'],
    },
  },
  {
    name: 'rescheduleAppointment',
    description:
      'Move an existing appointment to a new time (and optionally new services/staff). Only call this after the customer has explicitly confirmed the new time.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        newStartTime: { type: 'string', description: 'ISO-8601.' },
        services: {
          type: 'array',
          description: 'Omit to keep the existing service/staff assignment.',
          items: {
            type: 'object',
            properties: {
              serviceId: { type: 'string' },
              employeeId: { type: 'string' },
            },
            required: ['serviceId', 'employeeId'],
          },
        },
      },
      required: ['appointmentId', 'newStartTime'],
    },
  },
  {
    name: 'cancelAppointment',
    description:
      'Cancel an existing appointment. Only call this after the customer has explicitly confirmed the cancellation.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        reason: {
          type: 'string',
          description: "The customer's stated reason, if given.",
        },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'recommendService',
    description:
      "Look up this salon's active service catalog, optionally filtered by a search term, to recommend a service to the customer.",
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Optional free-text search (e.g. "haircut", "color").',
        },
      },
    },
  },
  {
    name: 'answerFaq',
    description:
      'Answer a factual question about this salon (hours, location, contact info, policies, service pricing/duration) grounded strictly on real data. Never answer these questions from memory — always call this tool.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
      required: ['question'],
    },
  },
  {
    name: 'escalateToHuman',
    description:
      'Hand this conversation off to a human staff member and stop responding automatically. Call this when the customer explicitly asks for a human, is upset or complaining, asks for something outside your other tools, or you have failed to understand their intent after a couple of attempts.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
];
