import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import {
  AppointmentsService,
  type AiActorContext,
  type CreateAppointmentRequest,
  type RescheduleAppointmentRequest,
} from '../../appointments/application/appointments.service';
import { AvailabilityService } from '../../availability/application/availability.service';
import { BusinessHoursService } from '../../salon/application/business-hours.service';
import { SalonProfileService } from '../../salon/application/salon-profile.service';
import { ServiceService } from '../../services/application/service.service';
import { ConversationsService } from '../../whatsapp/application/conversations.service';
import {
  LLM_PROVIDER,
  type LlmProviderPort,
} from '../domain/ports/llm-provider.port';
import { PromptBuilderService } from './prompt-builder.service';
import { GuardrailRejectedException } from './exceptions/ai.exceptions';

export interface CheckAvailabilityArgs {
  serviceId: string;
  employeeId?: string;
  dateFrom: string;
  dateTo: string;
}

export interface RecommendServiceArgs {
  q?: string;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Every tool named in SYSTEM_ARCHITECTURE.md 5.3, implemented as thin
 * orchestration over the *existing* module services — never a parallel/
 * duplicated implementation of booking, availability, or catalog logic
 * (docs/adr/ADR-011-ai-receptionist.md). `checkAvailability`/
 * `recommendService` have no dedicated `POST /ai/tools/*` HTTP endpoint
 * (API_SPECIFICATION.md Section 12 only documents four) — they're
 * read-only enough that the testable-HTTP-surface rationale doesn't apply;
 * `book`/`reschedule`/`cancel`/`answerFaq` do, and this service's methods
 * are exactly what those controllers call, so there is one implementation
 * either way.
 *
 * Every method here re-validates the model's arguments against real
 * tenant data before executing and throws (never silently coerces) on a
 * hallucinated reference — SYSTEM_ARCHITECTURE.md 5.9's "model output is
 * untrusted input" rule. `ConversationOrchestratorService` catches these
 * exceptions and feeds the failure back to the model as a structured tool
 * result (5.10); the `POST /ai/tools/*` controllers let them propagate as
 * real HTTP errors instead — two callers, one implementation.
 */
@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly salonProfile: SalonProfileService,
    private readonly businessHours: BusinessHoursService,
    private readonly services: ServiceService,
    private readonly conversations: ConversationsService,
    private readonly promptBuilder: PromptBuilderService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProviderPort,
  ) {}

  async checkAvailability(tenantId: string, args: CheckAvailabilityArgs) {
    const slots = await this.availability.getAvailableSlots(tenantId, {
      serviceId: args.serviceId,
      employeeId: args.employeeId,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
    });
    return {
      slots: slots.map((slot) => ({
        employeeId: slot.employeeId,
        employeeName: slot.employeeName,
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
      })),
    };
  }

  async book(
    tenantId: string,
    aiActor: AiActorContext,
    request: CreateAppointmentRequest,
  ) {
    const appointment = await this.appointments.createAppointmentForAi(
      tenantId,
      request,
      aiActor,
    );
    return toAppointmentToolResult(appointment);
  }

  async reschedule(
    tenantId: string,
    appointmentId: string,
    aiActor: AiActorContext,
    request: RescheduleAppointmentRequest,
  ) {
    const { newAppointment, warnings } =
      await this.appointments.rescheduleAppointmentForAi(
        tenantId,
        appointmentId,
        request,
        aiActor,
      );
    return { ...toAppointmentToolResult(newAppointment), warnings };
  }

  async cancel(
    tenantId: string,
    appointmentId: string,
    reason: string | undefined,
    aiActor: AiActorContext,
  ) {
    const { appointment, warnings } =
      await this.appointments.cancelAppointmentForAi(
        tenantId,
        appointmentId,
        reason,
        aiActor,
      );
    return { ...toAppointmentToolResult(appointment), warnings };
  }

  async recommendService(tenantId: string, args: RecommendServiceArgs) {
    const { services } = await this.services.listServices(tenantId, {
      isActive: true,
      q: args.q,
      sortField: 'displayOrder',
      sortDirection: 'asc',
      page: 1,
      limit: 10,
    });
    return {
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        currency: service.currency,
      })),
    };
  }

  /**
   * The one tool that internally makes its own narrow LLM call (grounded
   * strictly on the data assembled below) — `POST /ai/tools/faq`'s
   * documented contract returns a synthesized natural-language `answer`,
   * not raw data, so this tool must be able to produce one on its own
   * without depending on the outer conversation loop.
   */
  async answerFaq(tenantId: string, question: string) {
    const [profile, hours, catalog] = await Promise.all([
      this.salonProfile.getProfile(tenantId),
      this.businessHours.getBusinessHours(tenantId),
      this.services.listServices(tenantId, {
        isActive: true,
        sortField: 'displayOrder',
        sortDirection: 'asc',
        page: 1,
        limit: 50,
      }),
    ]);

    const groundedOn = ['SalonProfile', 'BusinessHours', 'Service'];
    const groundedData = formatGroundedData(profile, hours, catalog.services);
    const { prompt, promptVersion } = this.promptBuilder.buildFaqPrompt(
      question,
      groundedData,
    );

    const result = await this.llm.complete({
      systemPrompt: prompt,
      messages: [],
      tools: [],
    });

    const answer = result.content?.trim();
    if (!answer) {
      throw new GuardrailRejectedException(
        'No grounded answer exists for this question.',
        { question },
      );
    }

    return { answer, groundedOn, promptVersion };
  }

  async escalateToHuman(
    tenantId: string,
    conversationId: string,
    reason: string,
  ) {
    const conversation = await this.conversations.escalateConversation(
      tenantId,
      conversationId,
      reason,
      ActorType.AI,
    );
    return { conversationId: conversation.id, status: conversation.status };
  }
}

function toAppointmentToolResult(appointment: {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date;
  totalPriceCents: number;
  currency: string;
}) {
  return {
    appointmentId: appointment.id,
    status: appointment.status,
    startTime: appointment.startTime.toISOString(),
    endTime: appointment.endTime.toISOString(),
    totalPriceCents: appointment.totalPriceCents,
    currency: appointment.currency,
  };
}

function formatGroundedData(
  profile: {
    name: string;
    description: string | null;
    addressLine1: string | null;
    city: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    website: string | null;
  },
  hours: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isClosed: boolean;
  }>,
  catalog: Array<{
    name: string;
    description: string | null;
    durationMinutes: number;
    priceCents: number;
    currency: string;
  }>,
): string {
  const hoursLines = hours
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((day) =>
      day.isClosed
        ? `${DAY_NAMES[day.dayOfWeek]}: Closed`
        : `${DAY_NAMES[day.dayOfWeek]}: ${day.startTime}-${day.endTime}`,
    )
    .join('\n');

  const serviceLines = catalog
    .map(
      (service) =>
        `${service.name} — ${(service.priceCents / 100).toFixed(2)} ${service.currency}, ${service.durationMinutes} min${service.description ? `: ${service.description}` : ''}`,
    )
    .join('\n');

  return [
    `Salon: ${profile.name}${profile.description ? ` — ${profile.description}` : ''}`,
    profile.addressLine1
      ? `Address: ${profile.addressLine1}, ${profile.city ?? ''}`
      : '',
    profile.contactPhone ? `Phone: ${profile.contactPhone}` : '',
    profile.contactEmail ? `Email: ${profile.contactEmail}` : '',
    profile.website ? `Website: ${profile.website}` : '',
    '',
    'Business hours:',
    hoursLines,
    '',
    'Services:',
    serviceLines,
  ]
    .filter((line) => line !== '')
    .join('\n');
}
