import {
  ActorType,
  AppointmentHistoryAction,
  AppointmentStatus,
  ConversationStatus,
  EmployeeStatus,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
  PrismaClient,
  RoleName,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, randomBytes } from 'node:crypto';
import { DEMO_TENANT_SLUG } from './demo-constants';

/**
 * Demo-data generator for local/staging product demonstrations.
 *
 * Deliberately separate from `prisma/seed.ts` (Roles/Permissions/Plans —
 * required in every environment including production). This script is
 * dev/demo-only: it creates one fully fleshed-out tenant (salon, staff,
 * catalog, customers, appointments, WhatsApp conversations, billing, AI
 * config) so the product can be clicked through end-to-end without manual
 * data entry.
 *
 * Repeatable: `npm run demo:reset && npm run demo:seed` always reproduces
 * the same shape of data (values are randomized per run, but volumes/
 * relationships are not). Everything this script creates is scoped to one
 * tenant (`DEMO_TENANT_SLUG`) plus a handful of globally-shared reference
 * rows (PromptVersion) that are safe to upsert repeatedly and are left
 * alone by `demo-reset.ts`.
 *
 * Requires the base seed (`npm run prisma:seed`) to have already run —
 * this script depends on the OWNER role and at least one active Plan.
 */

const prisma = new PrismaClient();

const DEMO_OWNER_EMAIL = 'owner@aurorabeautylounge.demo';
const DEMO_PASSWORD = 'DemoPass123!';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_WINDOW_DAYS = 30;
const FUTURE_WINDOW_DAYS = 60;

// --- small helpers ----------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function pickWeighted<T>(weighted: ReadonlyArray<[T, number]>): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Mirrors `hhMmToTime` (prisma-salon.mappers.ts) — @db.Time columns store a fixed 1970-01-01 date. */
function hhMm(value: string): Date {
  return new Date(`1970-01-01T${value}:00Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Mirrors `EncryptionService` (core/security/encryption.service.ts) exactly, so the stored token is real AES-256-GCM ciphertext, not a placeholder string. */
function encryptToken(plaintext: string): string {
  const rawKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY must be set in backend/.env to seed a WhatsApp account.',
    );
  }
  const key = Buffer.from(rawKey, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

let whatsappIdCounter = 0;
function fakeWhatsappMessageId(): string {
  whatsappIdCounter += 1;
  return `wamid.DEMO${Date.now()}${whatsappIdCounter}`;
}

// --- reference data (names/content) ------------------------------------

const FIRST_NAMES = [
  'Olivia',
  'Amelia',
  'Isla',
  'Ava',
  'Mia',
  'Ivy',
  'Freya',
  'Grace',
  'Sophie',
  'Chloe',
  'Ella',
  'Lily',
  'Charlotte',
  'Emily',
  'Jessica',
  'Poppy',
  'Ruby',
  'Isabella',
  'Daisy',
  'Evie',
  'Noah',
  'Oliver',
  'George',
  'Arthur',
  'Muhammad',
  'Leo',
  'Oscar',
  'Harry',
  'Jack',
  'Charlie',
  'Freddie',
  'Theo',
  'Archie',
  'Alfie',
  'Henry',
  'Jacob',
  'Thomas',
  'William',
  'James',
  'Daniel',
  'Priya',
  'Aisha',
  'Fatima',
  'Zainab',
  'Amara',
  'Chen',
  'Wei',
  'Yuki',
  'Sofia',
  'Valentina',
  'Diego',
  'Mateo',
  'Santiago',
  'Kwame',
  'Chidi',
  'Amina',
  'Layla',
  'Nadia',
  'Elif',
  'Mei',
] as const;

const LAST_NAMES = [
  'Smith',
  'Jones',
  'Taylor',
  'Williams',
  'Brown',
  'Davies',
  'Evans',
  'Wilson',
  'Thomas',
  'Roberts',
  'Johnson',
  'Lewis',
  'Walker',
  'Robinson',
  'Wood',
  'Thompson',
  'White',
  'Watson',
  'Jackson',
  'Wright',
  'Green',
  'Harris',
  'Cooper',
  'King',
  'Lee',
  'Baker',
  'Hall',
  'Clarke',
  'Patel',
  'Khan',
  'Ahmed',
  'Ali',
  'Hussain',
  'Begum',
  'Chowdhury',
  'Singh',
  'Kaur',
  'Chen',
  'Wang',
  'Kim',
  'Nguyen',
  'Silva',
  'Costa',
  'Rossi',
  'Muller',
  'Andersson',
  'Kowalski',
  'Nowak',
  'Diallo',
  'Okafor',
] as const;

function randomFullName(): { firstName: string; lastName: string } {
  return { firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES) };
}

// --- main --------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding demo tenant "${DEMO_TENANT_SLUG}"...`);

  const ownerRole = await prisma.role.findUnique({
    where: { name: RoleName.OWNER },
  });
  if (!ownerRole) {
    throw new Error(
      'OWNER role is not seeded. Run `npm run prisma:seed` before `npm run demo:seed`.',
    );
  }
  const proPlan = await prisma.plan.findFirst({
    where: { name: 'Professional', isActive: true },
  });
  if (!proPlan) {
    throw new Error(
      'No active "Professional" Plan found. Run `npm run prisma:seed` before `npm run demo:seed`.',
    );
  }

  const existing = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
  });
  if (existing) {
    throw new Error(
      `Demo tenant already exists (slug "${DEMO_TENANT_SLUG}"). Run \`npm run demo:reset\` first.`,
    );
  }

  const { tenant, ownerUserId } = await createTenantAndOwner(ownerRole.id);
  console.log(`  tenant: ${tenant.name} (${tenant.id})`);

  await createTenantSettings(tenant.id);
  await createSalonProfile(tenant.id);
  await createBusinessHours(tenant.id);
  console.log('  salon profile + business hours created');

  const employees = await createEmployees(tenant.id);
  console.log(`  ${employees.length} employees created`);

  const categories = await createServiceCategories(tenant.id);
  const services = await createServices(tenant.id, categories);
  console.log(
    `  ${categories.length} categories, ${services.length} services created`,
  );

  await assignEmployeeServices(tenant.id, employees, services);

  const customers = await createCustomers(tenant.id, employees);
  console.log(`  ${customers.length} customers created`);

  const appointmentCount = await createAppointments(
    tenant.id,
    employees,
    services,
    customers,
  );
  console.log(`  ${appointmentCount} appointments created`);

  await createBilling(tenant.id, proPlan.id);
  console.log('  billing (subscription, invoices, payments) created');

  const whatsappAccount = await createWhatsAppAccount(tenant.id);
  const conversationCount = await createConversations(
    tenant.id,
    whatsappAccount.id,
    customers,
    ownerUserId,
  );
  console.log(
    `  WhatsApp account + ${conversationCount} conversations created`,
  );

  await createPromptVersions();
  await createAuditLogs(tenant.id, ownerUserId);
  console.log('  prompt versions + audit trail created');

  console.log('\nDemo seed complete.');
  console.log(`  Login: ${DEMO_OWNER_EMAIL} / ${DEMO_PASSWORD}`);
}

// --- section: tenant + owner --------------------------------------------

async function createTenantAndOwner(ownerRoleId: string) {
  const passwordHash = (await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
  })) as string;

  const now = new Date();
  const trialEndsAt = addDays(now, 14);

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Aurora Beauty Lounge & Spa',
      slug: DEMO_TENANT_SLUG,
      status: 'ACTIVE',
      timezone: 'Europe/London',
      addressLine1: '14 Regent Street',
      addressLine2: 'Ground Floor',
      city: 'London',
      countryCode: 'GB',
      defaultLocale: 'en',
      trialEndsAt,
    },
  });

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: DEMO_OWNER_EMAIL,
      passwordHash,
      firstName: 'Isabella',
      lastName: 'Moreau',
      isEmailVerified: true,
      isActive: true,
      lastLoginAt: now,
      roles: { create: { roleId: ownerRoleId } },
    },
  });

  return { tenant, ownerUserId: owner.id };
}

async function createTenantSettings(tenantId: string): Promise<void> {
  await prisma.tenantSettings.create({
    data: {
      tenantId,
      general: {
        ai: {
          enabled: true,
          tone: 'warm, professional, and concise',
          greetingMessage:
            "Hi! Welcome to Aurora Beauty Lounge & Spa ✨ I'm your virtual receptionist — I can help you book an appointment, check opening hours, or answer questions about our services. How can I help today?",
          escalationInstructions:
            'If the customer is upset, asks for a refund, mentions a complaint, or explicitly asks for a human, escalate immediately to staff rather than attempting to resolve it yourself.',
          fallbackMessage:
            "Sorry, I'm having trouble helping with that right now — one of our team will follow up with you shortly.",
          confidenceThreshold: 2,
        },
      },
      business: {
        brandVoice: 'friendly boutique salon, central London',
      },
    },
  });
}

async function createSalonProfile(tenantId: string): Promise<void> {
  await prisma.salonProfile.create({
    data: {
      tenantId,
      description:
        'A boutique beauty destination in the heart of London offering hair, nails, facials, massage, waxing, makeup, and spa treatments in a calm, modern space.',
      contactEmail: 'hello@aurorabeautylounge.demo',
      contactPhone: '+44 20 7946 0958',
      website: 'https://aurorabeautylounge.demo',
      currency: 'GBP',
      logoUrl: null,
      primaryColor: '#8B5CF6',
      secondaryColor: '#F472B6',
    },
  });
}

async function createBusinessHours(tenantId: string): Promise<void> {
  // 0=Sunday..6=Saturday. Closed Sunday, shorter hours Saturday.
  const days: Array<{
    dayOfWeek: number;
    start: string;
    end: string;
    closed?: boolean;
  }> = [
    { dayOfWeek: 0, start: '00:00', end: '00:00', closed: true },
    { dayOfWeek: 1, start: '09:00', end: '18:00' },
    { dayOfWeek: 2, start: '09:00', end: '18:00' },
    { dayOfWeek: 3, start: '09:00', end: '18:00' },
    { dayOfWeek: 4, start: '09:00', end: '20:00' },
    { dayOfWeek: 5, start: '09:00', end: '20:00' },
    { dayOfWeek: 6, start: '10:00', end: '17:00' },
  ];

  await prisma.businessHours.createMany({
    data: days.map((d) => ({
      tenantId,
      dayOfWeek: d.dayOfWeek,
      startTime: hhMm(d.start),
      endTime: hhMm(d.end),
      isClosed: Boolean(d.closed),
    })),
  });
}

// --- section: employees --------------------------------------------------

interface EmployeeSpec {
  firstName: string;
  lastName: string;
  colorTag: string;
  bio: string;
  status: EmployeeStatus;
  phone: string;
  skills: string[]; // ServiceCategory names
  workingDays: Array<{ dayOfWeek: number; start: string; end: string }>;
  timeOff: Array<{
    startOffsetDays: number;
    endOffsetDays: number;
    reason: string;
  }>;
}

const EMPLOYEE_SPECS: EmployeeSpec[] = [
  {
    firstName: 'Sofia',
    lastName: 'Martinez',
    colorTag: '#F87171',
    bio: 'Senior hair stylist with 10 years of experience in color and cutting.',
    status: 'ACTIVE',
    phone: '+44 7700 900101',
    skills: ['Hair'],
    workingDays: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '17:00',
    })),
    timeOff: [
      { startOffsetDays: 12, endOffsetDays: 16, reason: 'Annual leave' },
    ],
  },
  {
    firstName: 'James',
    lastName: 'Chen',
    colorTag: '#60A5FA',
    bio: 'Creative stylist specializing in modern cuts and editorial makeup looks.',
    status: 'ACTIVE',
    phone: '+44 7700 900102',
    skills: ['Hair', 'Makeup'],
    workingDays: [2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: '10:00',
      end: '18:00',
    })),
    timeOff: [
      { startOffsetDays: -10, endOffsetDays: -8, reason: 'Sick leave' },
    ],
  },
  {
    firstName: 'Aaliyah',
    lastName: 'Johnson',
    colorTag: '#34D399',
    bio: 'Nail technician known for precision gel work and nail art.',
    status: 'ACTIVE',
    phone: '+44 7700 900103',
    skills: ['Nails'],
    workingDays: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '17:00',
    })),
    timeOff: [
      { startOffsetDays: 30, endOffsetDays: 33, reason: 'Annual leave' },
    ],
  },
  {
    firstName: 'Priya',
    lastName: 'Patel',
    colorTag: '#FBBF24',
    bio: 'Nail and waxing specialist, gentle technique for sensitive skin.',
    status: 'ACTIVE',
    phone: '+44 7700 900104',
    skills: ['Nails', 'Waxing'],
    workingDays: [3, 4, 5, 6, 0].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '17:00',
    })),
    timeOff: [{ startOffsetDays: 45, endOffsetDays: 47, reason: 'Personal' }],
  },
  {
    firstName: 'Lucas',
    lastName: 'Silva',
    colorTag: '#A78BFA',
    bio: 'Massage therapist with a background in sports and deep tissue therapy.',
    status: 'ACTIVE',
    phone: '+44 7700 900105',
    skills: ['Massage', 'Spa'],
    workingDays: [1, 3, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: '11:00',
      end: '19:00',
    })),
    timeOff: [
      { startOffsetDays: 20, endOffsetDays: 22, reason: 'Annual leave' },
    ],
  },
  {
    firstName: 'Emma',
    lastName: 'Wilson',
    colorTag: '#F472B6',
    bio: 'Facialist and spa therapist focused on skin health and relaxation.',
    status: 'ACTIVE',
    phone: '+44 7700 900106',
    skills: ['Facial', 'Spa'],
    workingDays: [2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '17:00',
    })),
    timeOff: [{ startOffsetDays: -5, endOffsetDays: -4, reason: 'Personal' }],
  },
  {
    firstName: 'Noah',
    lastName: 'Anderson',
    colorTag: '#38BDF8',
    bio: 'Massage therapist specializing in sports recovery.',
    status: 'ON_LEAVE',
    phone: '+44 7700 900107',
    skills: ['Massage'],
    workingDays: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      start: '12:00',
      end: '20:00',
    })),
    timeOff: [
      { startOffsetDays: 0, endOffsetDays: 21, reason: 'Extended leave' },
    ],
  },
  {
    firstName: 'Grace',
    lastName: 'Kim',
    colorTag: '#FB923C',
    bio: 'All-round beauty therapist covering facials, makeup, and waxing.',
    status: 'ACTIVE',
    phone: '+44 7700 900108',
    skills: ['Facial', 'Makeup', 'Waxing'],
    workingDays: [1, 2, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '17:00',
    })),
    timeOff: [
      { startOffsetDays: 38, endOffsetDays: 40, reason: 'Annual leave' },
    ],
  },
];

interface CreatedEmployee {
  id: string;
  skills: string[];
  workingDays: Map<number, { start: string; end: string }>;
  timeOff: Array<{ start: Date; end: Date }>;
}

async function createEmployees(tenantId: string): Promise<CreatedEmployee[]> {
  const now = new Date();
  const created: CreatedEmployee[] = [];

  for (const spec of EMPLOYEE_SPECS) {
    const employee = await prisma.employee.create({
      data: {
        tenantId,
        firstName: spec.firstName,
        lastName: spec.lastName,
        phoneNumber: spec.phone,
        status: spec.status,
        colorTag: spec.colorTag,
        bio: spec.bio,
      },
    });

    await prisma.workingHours.createMany({
      data: spec.workingDays.map((d) => ({
        tenantId,
        employeeId: employee.id,
        dayOfWeek: d.dayOfWeek,
        startTime: hhMm(d.start),
        endTime: hhMm(d.end),
        isActive: true,
      })),
    });

    const timeOff = spec.timeOff.map((t) => ({
      start: addDays(now, t.startOffsetDays),
      end: addDays(now, t.endOffsetDays),
    }));
    if (timeOff.length > 0) {
      await prisma.employeeTimeOff.createMany({
        data: spec.timeOff.map((t) => ({
          tenantId,
          employeeId: employee.id,
          startDate: addDays(now, t.startOffsetDays),
          endDate: addDays(now, t.endOffsetDays),
          reason: t.reason,
        })),
      });
    }

    const workingDaysMap = new Map<number, { start: string; end: string }>();
    for (const d of spec.workingDays) {
      workingDaysMap.set(d.dayOfWeek, { start: d.start, end: d.end });
    }

    created.push({
      id: employee.id,
      skills: spec.skills,
      workingDays: workingDaysMap,
      timeOff,
    });
  }

  return created;
}

// --- section: service catalog --------------------------------------------

const CATEGORY_NAMES = [
  'Hair',
  'Nails',
  'Facial',
  'Massage',
  'Waxing',
  'Makeup',
  'Spa',
] as const;

interface ServiceSpec {
  name: string;
  durationMinutes: number;
  priceGbp: number;
  bufferMinutes: number;
}

const SERVICES_BY_CATEGORY: Record<
  (typeof CATEGORY_NAMES)[number],
  ServiceSpec[]
> = {
  Hair: [
    {
      name: "Women's Haircut & Style",
      durationMinutes: 60,
      priceGbp: 55,
      bufferMinutes: 10,
    },
    {
      name: "Men's Haircut",
      durationMinutes: 30,
      priceGbp: 28,
      bufferMinutes: 5,
    },
    { name: 'Blowout', durationMinutes: 45, priceGbp: 38, bufferMinutes: 10 },
    {
      name: 'Full Colour',
      durationMinutes: 120,
      priceGbp: 110,
      bufferMinutes: 15,
    },
    {
      name: 'Balayage',
      durationMinutes: 180,
      priceGbp: 185,
      bufferMinutes: 20,
    },
    {
      name: 'Deep Conditioning Treatment',
      durationMinutes: 30,
      priceGbp: 32,
      bufferMinutes: 5,
    },
  ],
  Nails: [
    {
      name: 'Classic Manicure',
      durationMinutes: 30,
      priceGbp: 24,
      bufferMinutes: 5,
    },
    {
      name: 'Gel Manicure',
      durationMinutes: 45,
      priceGbp: 34,
      bufferMinutes: 10,
    },
    {
      name: 'Classic Pedicure',
      durationMinutes: 45,
      priceGbp: 32,
      bufferMinutes: 10,
    },
    {
      name: 'Gel Pedicure',
      durationMinutes: 60,
      priceGbp: 42,
      bufferMinutes: 10,
    },
    {
      name: 'Nail Art (add-on)',
      durationMinutes: 20,
      priceGbp: 12,
      bufferMinutes: 0,
    },
    {
      name: 'Acrylic Full Set',
      durationMinutes: 90,
      priceGbp: 55,
      bufferMinutes: 10,
    },
  ],
  Facial: [
    {
      name: 'Express Facial',
      durationMinutes: 30,
      priceGbp: 38,
      bufferMinutes: 10,
    },
    {
      name: 'Signature Facial',
      durationMinutes: 60,
      priceGbp: 72,
      bufferMinutes: 10,
    },
    {
      name: 'Anti-Ageing Facial',
      durationMinutes: 75,
      priceGbp: 95,
      bufferMinutes: 15,
    },
    {
      name: 'Deep Cleansing Facial',
      durationMinutes: 60,
      priceGbp: 65,
      bufferMinutes: 10,
    },
    {
      name: 'Microdermabrasion',
      durationMinutes: 45,
      priceGbp: 82,
      bufferMinutes: 15,
    },
  ],
  Massage: [
    {
      name: 'Swedish Massage',
      durationMinutes: 60,
      priceGbp: 75,
      bufferMinutes: 10,
    },
    {
      name: 'Deep Tissue Massage',
      durationMinutes: 60,
      priceGbp: 85,
      bufferMinutes: 10,
    },
    {
      name: 'Hot Stone Massage',
      durationMinutes: 90,
      priceGbp: 110,
      bufferMinutes: 15,
    },
    {
      name: 'Prenatal Massage',
      durationMinutes: 60,
      priceGbp: 80,
      bufferMinutes: 10,
    },
    {
      name: 'Sports Massage',
      durationMinutes: 45,
      priceGbp: 68,
      bufferMinutes: 10,
    },
  ],
  Waxing: [
    {
      name: 'Eyebrow Wax',
      durationMinutes: 15,
      priceGbp: 14,
      bufferMinutes: 5,
    },
    {
      name: 'Full Leg Wax',
      durationMinutes: 45,
      priceGbp: 45,
      bufferMinutes: 10,
    },
    {
      name: 'Bikini Wax',
      durationMinutes: 30,
      priceGbp: 34,
      bufferMinutes: 10,
    },
    {
      name: 'Underarm Wax',
      durationMinutes: 15,
      priceGbp: 16,
      bufferMinutes: 5,
    },
    {
      name: 'Full Body Wax',
      durationMinutes: 120,
      priceGbp: 125,
      bufferMinutes: 15,
    },
  ],
  Makeup: [
    {
      name: 'Bridal Makeup',
      durationMinutes: 90,
      priceGbp: 130,
      bufferMinutes: 15,
    },
    {
      name: 'Evening Makeup',
      durationMinutes: 60,
      priceGbp: 68,
      bufferMinutes: 10,
    },
    {
      name: 'Makeup Lesson',
      durationMinutes: 60,
      priceGbp: 78,
      bufferMinutes: 10,
    },
    {
      name: 'Special Occasion Makeup',
      durationMinutes: 75,
      priceGbp: 85,
      bufferMinutes: 10,
    },
  ],
  Spa: [
    {
      name: 'Spa Day Package',
      durationMinutes: 180,
      priceGbp: 235,
      bufferMinutes: 20,
    },
    {
      name: 'Body Scrub',
      durationMinutes: 45,
      priceGbp: 58,
      bufferMinutes: 10,
    },
    {
      name: 'Aromatherapy Wrap',
      durationMinutes: 60,
      priceGbp: 78,
      bufferMinutes: 10,
    },
    {
      name: 'Couples Spa Retreat',
      durationMinutes: 150,
      priceGbp: 220,
      bufferMinutes: 20,
    },
  ],
};

interface CreatedCategory {
  id: string;
  name: (typeof CATEGORY_NAMES)[number];
}

async function createServiceCategories(
  tenantId: string,
): Promise<CreatedCategory[]> {
  const created: CreatedCategory[] = [];
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    const name = CATEGORY_NAMES[i];
    const category = await prisma.serviceCategory.create({
      data: { tenantId, name, displayOrder: i },
    });
    created.push({ id: category.id, name });
  }
  return created;
}

export interface CreatedService {
  id: string;
  name: string;
  categoryName: (typeof CATEGORY_NAMES)[number];
  durationMinutes: number;
  priceCents: number;
  bufferTimeMinutes: number;
}

async function createServices(
  tenantId: string,
  categories: CreatedCategory[],
): Promise<CreatedService[]> {
  const created: CreatedService[] = [];
  let displayOrder = 0;

  for (const category of categories) {
    const specs = SERVICES_BY_CATEGORY[category.name];
    for (const spec of specs) {
      const service = await prisma.service.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: spec.name,
          description: `${spec.name} at Aurora Beauty Lounge & Spa.`,
          durationMinutes: spec.durationMinutes,
          priceCents: Math.round(spec.priceGbp * 100),
          currency: 'GBP',
          bufferTimeMinutes: spec.bufferMinutes,
          isActive: true,
          displayOrder: displayOrder++,
        },
      });
      created.push({
        id: service.id,
        name: service.name,
        categoryName: category.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        bufferTimeMinutes: service.bufferTimeMinutes,
      });
    }
  }

  return created;
}

async function assignEmployeeServices(
  tenantId: string,
  employees: CreatedEmployee[],
  services: CreatedService[],
): Promise<void> {
  const rows: Array<{
    tenantId: string;
    employeeId: string;
    serviceId: string;
  }> = [];
  for (const employee of employees) {
    for (const service of services) {
      if (employee.skills.includes(service.categoryName)) {
        rows.push({ tenantId, employeeId: employee.id, serviceId: service.id });
      }
    }
  }
  await prisma.employeeService.createMany({ data: rows });
}

// --- section: customers ---------------------------------------------------

export interface CreatedCustomer {
  id: string;
  firstName: string;
  lastName: string;
}

async function createCustomers(
  tenantId: string,
  employees: CreatedEmployee[],
): Promise<CreatedCustomer[]> {
  // Customer has no notes/preferredEmployee/preferredService columns in the
  // schema (see prisma/schema.prisma's Customer model — CustomerNote/
  // CustomerPreference were deliberately deferred, ADR-008/"narrow the ask"
  // precedent) — nothing in this function stores a preference anywhere.
  const CUSTOMER_COUNT = 160;
  const created: CreatedCustomer[] = [];

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const { firstName, lastName } = randomFullName();
    const phoneNumber = `+44 7${String(700_000_000 + i * 37 + randomInt(0, 36)).padStart(9, '0')}`;
    const email =
      Math.random() < 0.85
        ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example-demo.com`
        : null;

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        phoneNumber,
        firstName,
        lastName,
        email,
        preferredLanguage:
          Math.random() < 0.92 ? 'en' : pick(['es', 'fr', 'pl']),
        marketingOptIn: Math.random() < 0.6,
      },
    });

    created.push({ id: customer.id, firstName, lastName });
  }

  void employees;
  return created;
}

// --- section: appointments -------------------------------------------------

interface AppointmentSlot {
  employee: CreatedEmployee;
  employeeId: string;
  customer: CreatedCustomer;
  services: CreatedService[];
  startTime: Date;
  endTime: Date; // sum of service durations, excludes trailing buffer
  blockedUntil: Date; // endTime + trailing buffer
  totalPriceCents: number;
}

function isOnTimeOff(employee: CreatedEmployee, day: Date): boolean {
  return employee.timeOff.some((t) => day >= t.start && day <= t.end);
}

function buildEmployeeTimeline(
  tenantId: string,
  employee: CreatedEmployee,
  services: CreatedService[],
  customers: CreatedCustomer[],
  windowStart: Date,
  windowEnd: Date,
): AppointmentSlot[] {
  const eligibleServices = services.filter((s) =>
    employee.skills.includes(s.categoryName),
  );
  if (eligibleServices.length === 0) return [];

  const slots: AppointmentSlot[] = [];

  for (
    let day = new Date(windowStart);
    day <= windowEnd;
    day = addDays(day, 1)
  ) {
    const dayOfWeek = day.getUTCDay();
    const hours = employee.workingDays.get(dayOfWeek);
    if (!hours) continue;
    if (isOnTimeOff(employee, day)) continue;
    // Randomly skip some working days for realism (not fully booked every day).
    if (Math.random() < 0.12) continue;

    const dayStr = day.toISOString().slice(0, 10);
    let cursor = new Date(`${dayStr}T${hours.start}:00Z`);
    const dayEnd = new Date(`${dayStr}T${hours.end}:00Z`);

    const maxAppointmentsToday = randomInt(3, 6);
    let appointmentsToday = 0;

    while (appointmentsToday < maxAppointmentsToday) {
      // 1-2 services per appointment, occasionally.
      const serviceCount = Math.random() < 0.25 ? 2 : 1;
      const chosen: CreatedService[] = [];
      for (let i = 0; i < serviceCount; i++) {
        chosen.push(pick(eligibleServices));
      }

      const totalDuration = chosen.reduce(
        (sum, s) => sum + s.durationMinutes,
        0,
      );
      const trailingBuffer = chosen[chosen.length - 1].bufferTimeMinutes;
      const endTime = addMinutes(cursor, totalDuration);
      const blockedUntil = addMinutes(endTime, trailingBuffer);

      if (blockedUntil > dayEnd) break;

      const totalPriceCents = chosen.reduce((sum, s) => sum + s.priceCents, 0);

      slots.push({
        employee,
        employeeId: employee.id,
        customer: pick(customers),
        services: chosen,
        startTime: new Date(cursor),
        endTime,
        blockedUntil,
        totalPriceCents,
      });

      appointmentsToday++;
      // Gap between appointments: sometimes back-to-back, sometimes a break.
      const gapMinutes = Math.random() < 0.5 ? 0 : randomInt(15, 45);
      cursor = addMinutes(blockedUntil, gapMinutes);
    }
  }

  void tenantId;
  return slots;
}

async function createAppointments(
  tenantId: string,
  employees: CreatedEmployee[],
  services: CreatedService[],
  customers: CreatedCustomer[],
): Promise<number> {
  const now = new Date();
  const windowStart = addDays(now, -PAST_WINDOW_DAYS);
  const windowEnd = addDays(now, FUTURE_WINDOW_DAYS);

  let created = 0;

  for (const employee of employees) {
    const timeline = buildEmployeeTimeline(
      tenantId,
      employee,
      services,
      customers,
      windowStart,
      windowEnd,
    );

    // Mark ~4% of past slots as "rescheduled away" into the very next slot
    // in this employee's own timeline (guarantees the successor slot is a
    // real, already-non-overlapping later time for the same employee).
    const rescheduledOriginIndices = new Set<number>();
    for (let i = 0; i < timeline.length - 1; i++) {
      if (timeline[i].startTime < now && Math.random() < 0.04) {
        rescheduledOriginIndices.add(i);
      }
    }

    for (let i = 0; i < timeline.length; i++) {
      const slot = timeline[i];
      const isPast = slot.startTime < now;
      const isRescheduleOrigin = rescheduledOriginIndices.has(i);

      let status: AppointmentStatus;
      let cancellationReason: string | null = null;
      let cancelledAt: Date | null = null;
      let isBlocking = true;

      if (isRescheduleOrigin) {
        status = 'RESCHEDULED';
        isBlocking = false;
      } else if (isPast) {
        status = pickWeighted<AppointmentStatus>([
          ['COMPLETED', 78],
          ['NO_SHOW', 8],
          ['CANCELLED', 14],
        ]);
      } else {
        status = pickWeighted<AppointmentStatus>([
          ['CONFIRMED', 82],
          ['CANCELLED', 13],
          ['RESCHEDULED', 5],
        ]);
      }

      if (status === 'CANCELLED') {
        isBlocking = false;
        cancelledAt = addMinutes(slot.startTime, -randomInt(60, 48 * 60));
        cancellationReason = pick([
          'Customer requested cancellation',
          'Schedule conflict',
          'Feeling unwell',
          'Found another provider',
          null,
        ]);
      }
      if (status === 'RESCHEDULED' && !isRescheduleOrigin) {
        // Future slot rescheduled away with no tracked successor (kept
        // simple — the origin->successor chain is only modeled going
        // forward from past slots via rescheduledOriginIndices above).
        isBlocking = false;
      }

      const rescheduledFromAppointmentId =
        !isRescheduleOrigin && rescheduledOriginIndices.has(i - 1)
          ? lastCreatedAppointmentId
          : undefined;

      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          customerId: slot.customer.id,
          employeeId: slot.employeeId,
          status,
          startTime: slot.startTime,
          endTime: slot.endTime,
          totalPriceCents: slot.totalPriceCents,
          currency: 'GBP',
          cancellationReason,
          cancelledAt,
          rescheduledFromAppointmentId,
          services: {
            create: slot.services.map((service, idx) => {
              const serviceStart =
                idx === 0
                  ? slot.startTime
                  : addMinutes(
                      slot.startTime,
                      sumDurations(slot.services.slice(0, idx)),
                    );
              const serviceEnd = addMinutes(
                serviceStart,
                service.durationMinutes,
              );
              const isLast = idx === slot.services.length - 1;
              return {
                tenantId,
                serviceId: service.id,
                employeeId: slot.employeeId,
                serviceNameSnapshot: service.name,
                durationMinutesSnapshot: service.durationMinutes,
                priceCentsSnapshot: service.priceCents,
                bufferMinutesSnapshot: service.bufferTimeMinutes,
                sequenceOrder: idx,
                startTime: serviceStart,
                endTime: serviceEnd,
                // Only the trailing leg carries a buffer — intermediate legs
                // in a multi-service appointment run back-to-back with no
                // gap, so their blockedUntil must equal their own endTime
                // (never the next leg's start), or the EXCLUDE constraint
                // sees two overlapping blocking ranges for the same
                // employee within one appointment.
                blockedUntil: isLast ? slot.blockedUntil : serviceEnd,
                isBlocking,
              };
            }),
          },
        },
      });

      lastCreatedAppointmentId = appointment.id;

      const historyRows: Array<{
        action: AppointmentHistoryAction;
        newState: object;
      }> = [{ action: 'CREATED', newState: { status: 'CONFIRMED' } }];
      if (status !== 'CONFIRMED') {
        historyRows.push({
          action:
            status === 'COMPLETED'
              ? 'COMPLETED'
              : status === 'NO_SHOW'
                ? 'NO_SHOW'
                : status === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'RESCHEDULED',
          newState: { status },
        });
      }
      await prisma.appointmentStatusHistory.createMany({
        data: historyRows.map((h) => ({
          tenantId,
          appointmentId: appointment.id,
          action: h.action,
          newState: h.newState,
          actorType: 'SYSTEM',
        })),
      });

      created++;
    }
  }

  return created;
}

function sumDurations(services: CreatedService[]): number {
  return services.reduce((sum, s) => sum + s.durationMinutes, 0);
}

// Tracks the most recently created appointment id so a reschedule-origin
// slot (index i) can be linked from its successor (index i+1) within the
// same employee timeline loop above.
let lastCreatedAppointmentId: string | undefined;

// --- section: billing -------------------------------------------------

async function createBilling(tenantId: string, planId: string): Promise<void> {
  const now = new Date();
  const periodStart = addDays(now, -18);
  const periodEnd = addDays(now, 12);

  const subscription = await prisma.subscription.create({
    data: {
      tenantId,
      planId,
      stripeCustomerId: 'cus_demo_aurora_beauty',
      stripeSubscriptionId: 'sub_demo_aurora_beauty',
      status: 'ACTIVE',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      messagesUsedCurrentPeriod: randomInt(180, 640),
      updatedByType: 'SYSTEM',
    },
  });

  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });

  for (let i = 2; i >= 0; i--) {
    const issuedAt = addDays(now, -18 - i * 30);
    const paidAt = addMinutes(issuedAt, randomInt(5, 240));
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        stripeInvoiceId: `in_demo_aurora_${i}`,
        amountDueCents: plan.monthlyPriceCents,
        amountPaidCents: plan.monthlyPriceCents,
        currency: plan.currency,
        status: 'PAID',
        invoicePdfUrl: null,
        issuedAt,
        dueAt: addDays(issuedAt, 14),
        paidAt,
      },
    });

    await prisma.payment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        stripePaymentIntentId: `pi_demo_aurora_${i}`,
        amountCents: plan.monthlyPriceCents,
        currency: plan.currency,
        status: 'SUCCEEDED',
        attemptedAt: paidAt,
      },
    });
  }
}

// --- section: WhatsApp + conversations -------------------------------------

async function createWhatsAppAccount(tenantId: string) {
  return prisma.whatsAppAccount.create({
    data: {
      tenantId,
      phoneNumber: '+44 20 7946 0958',
      whatsappPhoneNumberId: 'demo-phone-number-id-aurora',
      whatsappBusinessAccountId: 'demo-business-account-id-aurora',
      accessTokenEncrypted: encryptToken('demo-access-token-not-a-real-secret'),
      connectionStatus: WhatsAppConnectionStatus.CONNECTED,
      connectedAt: addDays(new Date(), -40),
      lastHealthCheckAt: new Date(),
    },
  });
}

interface ConversationScenario {
  status: ConversationStatus;
  escalate: boolean;
  escalationReason?: string;
  messages: Array<{ from: 'customer' | 'ai' | 'staff'; text: string }>;
}

const CONVERSATION_SCENARIOS: ConversationScenario[] = [
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'Hi, do you have any availability for a gel manicure this Saturday?',
      },
      {
        from: 'ai',
        text: "Hi! Welcome to Aurora Beauty Lounge & Spa ✨ Let me check Saturday's availability for a Gel Manicure — one moment.",
      },
      {
        from: 'ai',
        text: 'We have openings at 10:30, 11:15, and 2:00pm this Saturday with Aaliyah or Priya. Would any of those work?',
      },
      { from: 'customer', text: '11:15 works great, thank you!' },
      {
        from: 'ai',
        text: "You're all booked — Gel Manicure, Saturday 11:15am with Aaliyah. We'll send a reminder the day before. See you then!",
      },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'Hey, I need to reschedule my haircut appointment from tomorrow to next week if possible',
      },
      {
        from: 'ai',
        text: "No problem! I can see your Women's Haircut & Style booked for tomorrow at 2pm with Sofia. What day next week works best?",
      },
      { from: 'customer', text: 'Same time next Tuesday please' },
      {
        from: 'ai',
        text: "Done — you're now booked for Tuesday at 2:00pm with Sofia. Your original slot has been released.",
      },
    ],
  },
  {
    status: 'CLOSED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: "I won't be able to make my appointment on Friday, can I cancel please",
      },
      {
        from: 'ai',
        text: "Sorry to hear that! I've cancelled your Friday appointment — no charge. Would you like to rebook for another day?",
      },
      { from: 'customer', text: 'Not right now thanks' },
      {
        from: 'ai',
        text: 'No worries at all — just message us whenever you’re ready. Have a great day!',
      },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      { from: 'customer', text: 'What are your opening hours on Sundays?' },
      {
        from: 'ai',
        text: "We're closed on Sundays — open Monday to Saturday. Monday-Wednesday 9am-6pm, Thursday-Friday 9am-8pm, and Saturday 10am-5pm. Anything I can help you book?",
      },
      { from: 'customer', text: 'No that answers it, thanks!' },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'How much is a full colour and how long does it take?',
      },
      {
        from: 'ai',
        text: 'Full Colour is £110 and takes around 2 hours. We also offer Balayage at £185 (about 3 hours) if you’d like something more dimensional. Want me to check availability?',
      },
      {
        from: 'customer',
        text: 'Yes please, next Wednesday afternoon if possible',
      },
      {
        from: 'ai',
        text: 'We have 1:00pm and 3:30pm free next Wednesday with Sofia or James. Which would you prefer?',
      },
      { from: 'customer', text: '1pm please' },
      {
        from: 'ai',
        text: 'Booked! Full Colour, next Wednesday at 1:00pm with Sofia. See you then ✨',
      },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: "I've never been before — what would you recommend for dry, damaged hair?",
      },
      {
        from: 'ai',
        text: "Welcome! For dry or damaged hair, I'd recommend our Deep Conditioning Treatment (£32, 30 mins) paired with a Blowout, or if you're after a bigger refresh, a Full Colour includes a conditioning step too. Would you like me to book the Deep Conditioning Treatment?",
      },
      { from: 'customer', text: 'Yes, this Friday morning if you can' },
      {
        from: 'ai',
        text: 'You’re booked — Deep Conditioning Treatment, Friday 9:30am with Sofia. Looking forward to seeing you!',
      },
    ],
  },
  {
    status: 'ESCALATED',
    escalate: true,
    escalationReason: 'Customer requesting refund for unsatisfactory service',
    messages: [
      {
        from: 'customer',
        text: "I'm really not happy with my haircut yesterday, it's very uneven and not what I asked for",
      },
      {
        from: 'ai',
        text: "I'm so sorry to hear that — that's not the experience we want you to have. Let me connect you with our team right away to sort this out.",
      },
      {
        from: 'staff',
        text: "Hi, this is Isabella from Aurora Beauty Lounge, I'm so sorry about your haircut. Could you send a photo so I can take a look? We'd like to offer a complimentary correction or a refund, whichever you'd prefer.",
      },
      {
        from: 'customer',
        text: 'Ok, sending a photo now. I would like it corrected if possible',
      },
      {
        from: 'staff',
        text: "Thank you — I can see what happened. I've booked you in with our senior stylist Sofia tomorrow at 11am, free of charge, to fix this properly. Does that work?",
      },
      {
        from: 'customer',
        text: 'Yes that works, thank you for sorting this quickly',
      },
    ],
  },
  {
    status: 'ESCALATED',
    escalate: true,
    escalationReason: 'Customer explicitly asked to speak with a human',
    messages: [
      {
        from: 'customer',
        text: 'Can I speak to an actual person please, not a bot',
      },
      {
        from: 'ai',
        text: 'Of course — connecting you with a member of our team now.',
      },
      {
        from: 'staff',
        text: 'Hi, this is Grace from the front desk, how can I help?',
      },
      {
        from: 'customer',
        text: 'I wanted to book a spa package for 4 people for a hen do, is that something you can arrange?',
      },
      {
        from: 'staff',
        text: 'We absolutely can! Let me put together a group booking for you — what date were you thinking?',
      },
    ],
  },
  {
    status: 'OPEN',
    escalate: false,
    messages: [
      { from: 'customer', text: 'Do you do bridal makeup trials?' },
      {
        from: 'ai',
        text: 'Yes! Our Bridal Makeup service (£130, 90 mins) with James or Grace includes a full look, and we recommend booking a trial a few weeks before your big day. Would you like to check availability for a trial?',
      },
      {
        from: 'customer',
        text: 'Let me check my calendar and come back to you',
      },
    ],
  },
  {
    status: 'OPEN',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'Is Lucas available for a deep tissue massage this weekend?',
      },
      {
        from: 'ai',
        text: "Lucas works Mondays, Wednesdays, Fridays and Saturdays. Let me check this Saturday's availability for a Deep Tissue Massage.",
      },
      { from: 'customer', text: 'Great, thank you' },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      { from: 'customer', text: "What's included in the couples spa retreat?" },
      {
        from: 'ai',
        text: 'The Couples Spa Retreat (£220, 2.5 hours) includes a full body massage, facial, and access to our relaxation lounge for two — a lovely treat for anniversaries or just because! Shall I check availability?',
      },
      {
        from: 'customer',
        text: 'Yes please, any Saturday in the next few weeks',
      },
      {
        from: 'ai',
        text: 'We have this Saturday and the one after both open in the early afternoon. Which would you prefer?',
      },
      { from: 'customer', text: 'This Saturday, 1pm if possible' },
      {
        from: 'ai',
        text: "Booked! Couples Spa Retreat, Saturday 1:00pm with Lucas and Emma. We'll see you both then.",
      },
    ],
  },
  {
    status: 'CLOSED',
    escalate: false,
    messages: [
      { from: 'customer', text: 'Do you take walk-ins for eyebrow waxing?' },
      {
        from: 'ai',
        text: 'We generally recommend booking ahead to guarantee a slot, but we do sometimes have same-day openings — want me to check today’s availability?',
      },
      { from: 'customer', text: "No it's fine, I'll book properly next time" },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'What products do you use for facials? I have quite sensitive skin',
      },
      {
        from: 'ai',
        text: 'Great question — our facialists tailor product choice to your skin type, and we have fragrance-free, sensitive-skin-friendly ranges available. I’d recommend mentioning this when you arrive, or I can note it on your booking now if you’d like to book?',
      },
      {
        from: 'customer',
        text: 'Yes please book me a Signature Facial next week, noting the sensitivity',
      },
      {
        from: 'ai',
        text: "Booked — Signature Facial next Thursday at 10am with Emma, and I've added a note about your sensitive skin for the team.",
      },
    ],
  },
  {
    status: 'ESCALATED',
    escalate: true,
    escalationReason: 'Billing question outside AI scope',
    messages: [
      {
        from: 'customer',
        text: "I think I've been charged twice for my last appointment, can someone check?",
      },
      {
        from: 'ai',
        text: "I'm not able to look into billing directly, but I'll get our team to check this for you right away.",
      },
      {
        from: 'staff',
        text: 'Hi, this is Isabella — sorry about that, let me look into your payment history now.',
      },
      {
        from: 'staff',
        text: "You're right, there was a duplicate charge from our card terminal. I've processed a refund for the extra amount, you should see it in 3-5 business days. Really sorry for the hassle!",
      },
      { from: 'customer', text: 'Thank you for sorting it so quickly' },
    ],
  },
  {
    status: 'OPEN',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'Can you recommend something for a full pamper day before my birthday next month?',
      },
      {
        from: 'ai',
        text: 'Happy early birthday! Our Spa Day Package (£235, 3 hours) is perfect for that — it includes a massage, facial, and body scrub. Would you like me to check dates around your birthday?',
      },
      {
        from: 'customer',
        text: 'Yes, let me get back to you with the exact date',
      },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: "What's the difference between the Classic and Gel pedicure?",
      },
      {
        from: 'ai',
        text: 'Classic Pedicure (£32, 45 mins) uses regular polish that lasts about a week, while Gel Pedicure (£42, 60 mins) uses a gel polish that lasts 2-3 weeks and dries instantly. Would you like to book either?',
      },
      {
        from: 'customer',
        text: 'Gel pedicure please, this Thursday if possible',
      },
      {
        from: 'ai',
        text: 'You’re booked — Gel Pedicure, Thursday at 11am with Aaliyah.',
      },
    ],
  },
  {
    status: 'RESOLVED',
    escalate: false,
    messages: [
      {
        from: 'customer',
        text: 'Hi, can I book a full leg wax and eyebrow wax together?',
      },
      {
        from: 'ai',
        text: 'Of course, we can do those back-to-back — Full Leg Wax (45 mins) plus Eyebrow Wax (15 mins), one hour total with Priya. When suits you?',
      },
      { from: 'customer', text: 'Tuesday afternoon' },
      {
        from: 'ai',
        text: 'Booked — Full Leg Wax + Eyebrow Wax, Tuesday 2:00pm with Priya. See you then!',
      },
    ],
  },
];

async function createConversations(
  tenantId: string,
  whatsappAccountId: string,
  customers: CreatedCustomer[],
  ownerUserId: string,
): Promise<number> {
  const scenarioCustomers = shuffle(customers).slice(
    0,
    CONVERSATION_SCENARIOS.length,
  );
  const now = new Date();
  let count = 0;

  for (let i = 0; i < CONVERSATION_SCENARIOS.length; i++) {
    const scenario = CONVERSATION_SCENARIOS[i];
    const customer = scenarioCustomers[i];
    const startedAt = addDays(now, -randomInt(0, 20));

    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        customerId: customer.id,
        whatsappAccountId,
        status: scenario.status,
        assignedUserId: scenario.escalate ? ownerUserId : null,
        escalatedAt: scenario.escalate ? addMinutes(startedAt, 5) : null,
        escalationReason: scenario.escalationReason ?? null,
        resolvedAt:
          scenario.status === 'RESOLVED' ? addMinutes(startedAt, 30) : null,
        closedAt:
          scenario.status === 'CLOSED' ? addMinutes(startedAt, 45) : null,
      },
    });

    let cursor = startedAt;
    let lastInboundMessageAt: Date | null = null;
    for (const msg of scenario.messages) {
      cursor = addMinutes(cursor, randomInt(1, 6));
      const direction: MessageDirection =
        msg.from === 'customer' ? 'INBOUND' : 'OUTBOUND';
      const senderType: ActorType =
        msg.from === 'customer'
          ? 'CUSTOMER'
          : msg.from === 'ai'
            ? 'AI'
            : 'USER';

      await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction,
          senderType,
          senderId: msg.from === 'staff' ? ownerUserId : null,
          messageType: MessageType.TEXT,
          content: msg.text,
          whatsappMessageId: fakeWhatsappMessageId(),
          status:
            direction === 'INBOUND'
              ? MessageDeliveryStatus.READ
              : MessageDeliveryStatus.DELIVERED,
          aiPromptVersion: msg.from === 'ai' ? 'system-prompt@v1' : null,
          createdAt: cursor,
        },
      });

      if (direction === 'INBOUND') lastInboundMessageAt = cursor;
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: cursor, lastInboundMessageAt },
    });

    if (scenario.status === 'RESOLVED' || scenario.status === 'CLOSED') {
      await prisma.conversationSummary.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          summaryText: scenario.messages[0].text.slice(0, 200),
          messageCount: scenario.messages.length,
          lastCustomerIntent: scenario.escalate
            ? 'escalation'
            : 'booking_inquiry',
          aiPromptVersion: 'system-prompt@v1',
        },
      });
    } else {
      await prisma.aIContext.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          currentIntent: scenario.escalate ? 'escalation' : 'booking_inquiry',
          state: {},
          lastToolCall: scenario.escalate ? null : 'check_availability',
        },
      });
    }

    count++;
  }

  return count;
}

// --- section: AI prompt registry + audit log -------------------------------

async function createPromptVersions(): Promise<void> {
  const prompts = [
    {
      key: 'system-prompt',
      version: 'v1',
      description: 'Primary receptionist system prompt',
    },
    {
      key: 'faq-answering',
      version: 'v1',
      description: 'FAQ-answering tool instructions',
    },
    {
      key: 'escalation-instructions',
      version: 'v1',
      description: 'Escalation-to-human instructions',
    },
  ];

  for (const p of prompts) {
    await prisma.promptVersion.upsert({
      where: {
        uq_prompt_versions_key_version: { key: p.key, version: p.version },
      },
      update: { isActive: true, releasedAt: new Date() },
      create: { ...p, isActive: true, releasedAt: new Date() },
    });
  }
}

async function createAuditLogs(
  tenantId: string,
  ownerUserId: string,
): Promise<void> {
  const now = new Date();
  await prisma.auditLog.createMany({
    data: [
      {
        tenantId,
        action: 'TENANT_REGISTERED',
        entityType: 'Tenant',
        entityId: tenantId,
        actorType: 'SYSTEM',
        createdAt: addDays(now, -45),
      },
      {
        tenantId,
        action: 'SUBSCRIPTION_ACTIVATED',
        entityType: 'Subscription',
        actorType: 'SYSTEM',
        createdAt: addDays(now, -40),
      },
      {
        tenantId,
        action: 'WHATSAPP_ACCOUNT_CONNECTED',
        entityType: 'WhatsAppAccount',
        actorType: 'USER',
        actorId: ownerUserId,
        createdAt: addDays(now, -40),
      },
    ],
  });
}

main()
  .catch((error: unknown) => {
    console.error('Demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
