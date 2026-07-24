import {
  ActorType,
  AppointmentStatus,
  ConversationStatus,
} from '@prisma/client';
import { AppointmentsService } from '../../../src/modules/appointments/application/appointments.service';
import { AvailabilityService } from '../../../src/modules/availability/application/availability.service';
import { SalonProfileService } from '../../../src/modules/salon/application/salon-profile.service';
import { BusinessHoursService } from '../../../src/modules/salon/application/business-hours.service';
import { ServiceService } from '../../../src/modules/services/application/service.service';
import { ConversationsService } from '../../../src/modules/whatsapp/application/conversations.service';
import { PromptBuilderService } from '../../../src/modules/ai/application/prompt-builder.service';
import { ToolExecutorService } from '../../../src/modules/ai/application/tool-executor.service';
import { GuardrailRejectedException } from '../../../src/modules/ai/application/exceptions/ai.exceptions';
import type { LlmProviderPort } from '../../../src/modules/ai/domain/ports/llm-provider.port';

const aiActor = { actorType: ActorType.AI, conversationId: 'conversation-1' };

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appointment-1',
    status: AppointmentStatus.CONFIRMED,
    startTime: new Date('2026-08-03T14:00:00Z'),
    endTime: new Date('2026-08-03T14:45:00Z'),
    totalPriceCents: 8000,
    currency: 'USD',
    ...overrides,
  };
}

describe('ToolExecutorService', () => {
  let appointments: jest.Mocked<
    Pick<
      AppointmentsService,
      | 'createAppointmentForAi'
      | 'rescheduleAppointmentForAi'
      | 'cancelAppointmentForAi'
    >
  >;
  let availability: jest.Mocked<Pick<AvailabilityService, 'getAvailableSlots'>>;
  let salonProfile: jest.Mocked<Pick<SalonProfileService, 'getProfile'>>;
  let businessHours: jest.Mocked<
    Pick<BusinessHoursService, 'getBusinessHours'>
  >;
  let services: jest.Mocked<Pick<ServiceService, 'listServices'>>;
  let conversations: jest.Mocked<
    Pick<ConversationsService, 'escalateConversation'>
  >;
  let promptBuilder: jest.Mocked<Pick<PromptBuilderService, 'buildFaqPrompt'>>;
  let llm: jest.Mocked<LlmProviderPort>;
  let toolExecutor: ToolExecutorService;

  beforeEach(() => {
    appointments = {
      createAppointmentForAi: jest.fn(),
      rescheduleAppointmentForAi: jest.fn(),
      cancelAppointmentForAi: jest.fn(),
    };
    availability = { getAvailableSlots: jest.fn() };
    salonProfile = {
      getProfile: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        name: 'Bella Salon',
        addressLine1: '123 Main St',
        addressLine2: null,
        city: 'Springfield',
        countryCode: 'US',
        timezone: 'UTC',
        defaultLocale: 'en',
        description: 'A lovely salon.',
        contactEmail: 'hi@bella.com',
        contactPhone: '+15551234567',
        website: null,
        currency: 'USD',
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        updatedAt: new Date(),
      }),
    };
    businessHours = {
      getBusinessHours: jest.fn().mockResolvedValue([
        {
          id: 'bh-0',
          tenantId: 't',
          dayOfWeek: 0,
          startTime: '10:00',
          endTime: '16:00',
          isClosed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };
    services = {
      listServices: jest.fn().mockResolvedValue({
        services: [
          {
            id: 'service-1',
            tenantId: 'tenant-1',
            categoryId: null,
            name: 'Haircut',
            description: null,
            durationMinutes: 45,
            priceCents: 8000,
            currency: 'USD',
            bufferTimeMinutes: 10,
            isActive: true,
            displayOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 1,
      }),
    };
    conversations = {
      escalateConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        status: ConversationStatus.ESCALATED,
      }),
    };
    promptBuilder = {
      buildFaqPrompt: jest.fn().mockReturnValue({
        prompt: 'grounded faq prompt',
        promptVersion: 'faq-answering@v1',
      }),
    };
    llm = { complete: jest.fn() };

    toolExecutor = new ToolExecutorService(
      appointments as unknown as AppointmentsService,
      availability as unknown as AvailabilityService,
      salonProfile as unknown as SalonProfileService,
      businessHours as unknown as BusinessHoursService,
      services as unknown as ServiceService,
      conversations as unknown as ConversationsService,
      promptBuilder as unknown as PromptBuilderService,
      llm,
    );
  });

  describe('checkAvailability', () => {
    it('maps availability slots to ISO strings', async () => {
      availability.getAvailableSlots.mockResolvedValue([
        {
          employeeId: 'employee-1',
          employeeName: 'Ana Silva',
          startTime: new Date('2026-08-03T14:00:00Z'),
          endTime: new Date('2026-08-03T14:45:00Z'),
        },
      ]);

      const result = await toolExecutor.checkAvailability('tenant-1', {
        serviceId: 'service-1',
        dateFrom: '2026-08-03',
        dateTo: '2026-08-03',
      });

      expect(result.slots).toEqual([
        {
          employeeId: 'employee-1',
          employeeName: 'Ana Silva',
          startTime: '2026-08-03T14:00:00.000Z',
          endTime: '2026-08-03T14:45:00.000Z',
        },
      ]);
    });
  });

  describe('book', () => {
    it('delegates to createAppointmentForAi and shapes the result', async () => {
      appointments.createAppointmentForAi.mockResolvedValue(
        makeAppointment() as never,
      );

      const result = await toolExecutor.book('tenant-1', aiActor, {
        customerId: 'customer-1',
        startTime: new Date('2026-08-03T14:00:00Z'),
        services: [{ serviceId: 'service-1', employeeId: 'employee-1' }],
      });

      expect(result.appointmentId).toBe('appointment-1');
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
      expect(appointments.createAppointmentForAi).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ customerId: 'customer-1' }),
        aiActor,
      );
    });

    it('propagates a guardrail failure (e.g. a hallucinated serviceId) rather than swallowing it', async () => {
      appointments.createAppointmentForAi.mockRejectedValue(
        new Error('Invalid service reference'),
      );

      await expect(
        toolExecutor.book('tenant-1', aiActor, {
          customerId: 'customer-1',
          startTime: new Date(),
          services: [{ serviceId: 'nonexistent', employeeId: 'employee-1' }],
        }),
      ).rejects.toThrow('Invalid service reference');
    });
  });

  describe('reschedule', () => {
    it('delegates to rescheduleAppointmentForAi and includes warnings', async () => {
      appointments.rescheduleAppointmentForAi.mockResolvedValue({
        originalAppointment: makeAppointment({ id: 'appointment-1' }) as never,
        newAppointment: makeAppointment({ id: 'appointment-2' }) as never,
        warnings: ['Within cancellation notice window.'],
      });

      const result = await toolExecutor.reschedule(
        'tenant-1',
        'appointment-1',
        aiActor,
        { newStartTime: new Date('2026-08-04T10:00:00Z') },
      );

      expect(result.appointmentId).toBe('appointment-2');
      expect(result.warnings).toEqual(['Within cancellation notice window.']);
    });
  });

  describe('cancel', () => {
    it('delegates to cancelAppointmentForAi', async () => {
      appointments.cancelAppointmentForAi.mockResolvedValue({
        appointment: makeAppointment({
          status: AppointmentStatus.CANCELLED,
        }) as never,
        warnings: [],
      });

      const result = await toolExecutor.cancel(
        'tenant-1',
        'appointment-1',
        'Change of plans.',
        aiActor,
      );

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(appointments.cancelAppointmentForAi).toHaveBeenCalledWith(
        'tenant-1',
        'appointment-1',
        'Change of plans.',
        aiActor,
      );
    });
  });

  describe('recommendService', () => {
    it('only returns active services', async () => {
      const result = await toolExecutor.recommendService('tenant-1', {});

      expect(services.listServices).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ isActive: true }),
      );
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('Haircut');
    });
  });

  describe('answerFaq', () => {
    it('grounds the answer on real salon/business-hours/service data via a narrow LLM call', async () => {
      llm.complete.mockResolvedValue({
        content: "We're open Sundays 10am-4pm.",
        toolCalls: [],
        model: 'gpt-4o-mini',
      });

      const result = await toolExecutor.answerFaq(
        'tenant-1',
        'What are your hours on Sunday?',
      );

      expect(result.answer).toBe("We're open Sundays 10am-4pm.");
      expect(result.groundedOn).toEqual([
        'SalonProfile',
        'BusinessHours',
        'Service',
      ]);
      expect(promptBuilder.buildFaqPrompt).toHaveBeenCalledWith(
        'What are your hours on Sunday?',
        expect.stringContaining('Bella Salon'),
      );
    });

    it('throws GuardrailRejectedException when no grounded answer exists (empty model content)', async () => {
      llm.complete.mockResolvedValue({
        content: '',
        toolCalls: [],
        model: 'gpt-4o-mini',
      });

      await expect(
        toolExecutor.answerFaq('tenant-1', 'What is the meaning of life?'),
      ).rejects.toBeInstanceOf(GuardrailRejectedException);
    });
  });

  describe('escalateToHuman', () => {
    it('escalates with ActorType.AI', async () => {
      const result = await toolExecutor.escalateToHuman(
        'tenant-1',
        'conversation-1',
        'Customer requested a human.',
      );

      expect(result.status).toBe(ConversationStatus.ESCALATED);
      expect(conversations.escalateConversation).toHaveBeenCalledWith(
        'tenant-1',
        'conversation-1',
        'Customer requested a human.',
        ActorType.AI,
      );
    });
  });
});
