# PROJECT_REQUIREMENTS.md

## AI-Powered WhatsApp Receptionist for Salons & Beauty Businesses
### Multi-Tenant SaaS Platform — Software Requirements Document

**Document Status:** Draft for Approval
**Version:** 1.0
**Prepared for:** Product & Engineering Kickoff

---

## 1. Executive Summary

This document defines the business, functional, and non-functional requirements for a multi-tenant SaaS platform that gives salons and beauty businesses an AI-powered receptionist operating over WhatsApp. The AI receptionist answers customer questions, books/reschedules/cancels appointments, checks staff availability, recommends services, and hands off to a human when needed — all inside the customer's native WhatsApp conversation, with no app download required.

The platform is subscription-based, multi-tenant with strict per-salon data isolation, and built on a fixed technology stack: Angular 20 (frontend), NestJS + PostgreSQL + Prisma + Redis (backend), Docker/Hetzner/Nginx (infrastructure), OpenAI (AI), WhatsApp Business Cloud API (messaging), Stripe (billing), and S3-compatible storage.

This document is scoped to **requirements only**. It defines *what* must be built and *why*, not *how* it will be architected. Architecture, database schema, and diagrams are deliberately deferred to a follow-up phase pending approval of this document.

---

## 2. Business Goals

| # | Goal | Rationale |
|---|------|-----------|
| G1 | Reduce missed calls and lost bookings for salons | Salons routinely miss calls while servicing clients; each missed call is potential lost revenue. |
| G2 | Automate repetitive front-desk work | Front-desk staff spend significant time on repetitive scheduling/FAQ conversations that can be automated. |
| G3 | Increase booking conversion via instant response | Customers expect near-instant replies on WhatsApp; delayed responses lose bookings to competitors. |
| G4 | Build a recurring-revenue SaaS business | Subscription model with predictable MRR, low churn, and expansion revenue (multi-location, add-ons). |
| G5 | Scale to many salons without proportional support cost | Multi-tenant architecture with self-service onboarding keeps marginal cost per tenant low. |
| G6 | Establish a defensible, vertical-specific AI product | Generic chatbots don't understand salon-specific workflows (staff skill-matching, service duration, rebooking cadence); a vertical solution is more valuable and harder to replicate quickly. |

---

## 3. Project Vision

To become the default AI receptionist for independent salons and beauty businesses — the "front desk that never sleeps" — by owning the WhatsApp channel end-to-end: from first customer inquiry through booking, reminders, rescheduling, and post-visit rebooking, with zero app installs and minimal salon owner effort to configure and maintain.

Long-term, the platform should evolve from a reactive Q&A/booking bot into a proactive growth tool for salons — driving rebookings, reducing no-shows, and surfacing business insights — while remaining simple enough for a non-technical salon owner to run.

---

## 4. Problem Statement

Salons and beauty businesses face:

1. **High call volume during service hours** — staff are with clients and cannot answer the phone, resulting in missed bookings.
2. **Manual, repetitive scheduling work** — checking staff availability, matching services to time slots, and answering the same FAQs (hours, pricing, location, parking) consumes staff time.
3. **Fragmented communication channels** — Instagram DMs, phone calls, walk-ins, and WhatsApp messages must all be manually reconciled against one calendar.
4. **No after-hours coverage** — customers messaging outside business hours get no response until the next day, and often book elsewhere.
5. **High no-show rates** — inconsistent reminder practices lead to lost revenue from no-shows.
6. **Existing booking software is not conversational** — most booking widgets require the customer to leave WhatsApp and use a web form or app, creating friction and drop-off.

The platform solves this by embedding an AI receptionist directly inside WhatsApp — the channel customers already use — so no new habit or app adoption is required from either the salon or its customers.

---

## 5. Target Customers

- **Primary:** Independent salons and beauty businesses (hair, nails, spa, brows/lashes, barbershops) with 1–20 staff/chairs, typically without dedicated IT or a large front-desk team.
- **Secondary:** Small multi-location salon chains (2–10 locations) seeking centralized, consistent customer communication.
- **Geography:** Initially markets where WhatsApp Business is the dominant customer-messaging channel (e.g., Latin America, Europe, Middle East, South/Southeast Asia). This should be confirmed with the business (see Section 22).

**Out of initial target:** Enterprise chains (50+ locations) requiring custom integrations, franchise-specific billing, or on-premise deployment — these have materially different procurement and support needs.

---

## 6. User Personas

### 6.1 Salon Owner / Manager — "Maria"
- Runs a 4-chair hair salon, wears every hat (marketing, scheduling, finance).
- Not technical; expects software to "just work" with minimal setup.
- Cares about: reducing missed bookings, not paying for a receptionist she can't afford, keeping control over pricing/hours.
- Primary platform user: configures salon profile, services, staff, business hours, and monitors bookings/billing.

### 6.2 Front-Desk Staff / Salon Employee — "Ana"
- Works at the salon, sometimes covers the phone/WhatsApp between clients.
- Needs visibility into the AI's bookings and the ability to take over a conversation when a customer needs a human.
- Secondary platform user with restricted permissions (e.g., view calendar, handle handoffs — not billing or salon settings).

### 6.3 End Customer — "Sofia"
- A salon customer who messages the salon's WhatsApp number to book, reschedule, or ask questions.
- Does not use the web platform at all — interacts exclusively via WhatsApp.
- Expects fast, natural, humanlike responses and a simple booking experience.

### 6.4 Platform Administrator (Super Admin) — "Platform Ops"
- Employee of the SaaS company operating the platform.
- Manages tenants, subscriptions, platform-wide configuration, support, and monitoring.
- Needs tools to investigate issues across tenants, manage billing exceptions, and enforce platform policies.

---

## 7. User Roles

| Role | Scope | Description |
|------|-------|-------------|
| **Super Admin** | Platform-wide | SaaS operator staff. Full access across all tenants for support, billing oversight, and platform configuration. Not part of any single salon's tenant. |
| **Salon Owner / Admin** | Single tenant (salon) | Full control over their salon's account: settings, staff, services, WhatsApp connection, subscription/billing, AI configuration. |
| **Salon Manager** | Single tenant | Near-owner permissions, minus billing/subscription management and account deletion. Configurable per plan tier. |
| **Salon Staff (Employee)** | Single tenant, scoped | Views own calendar/availability, handles conversation handoffs, updates own working hours. No access to other staff's data unless permitted, no billing access. |
| **AI Agent (System Actor)** | Single tenant | Not a human role, but a first-class actor: acts within a conversation on behalf of the salon, constrained to tool-calling permissions defined by the salon's configuration. |
| **End Customer** | No platform account | Interacts only via WhatsApp; identified by phone number; has no login to the web platform. |

**Isolation requirement:** A user's role and permissions are always scoped to a single tenant (salon), except Super Admin. A Salon Owner/Manager/Staff account must never be able to read or act on another tenant's data under any circumstance (see Section 9 – Security).

---

## 8. Functional Requirements

Each feature includes **Why**, **Who**, **Business Value**, and **Priority** (Critical / High / Medium / Low).

### 8.1 Tenant & Account Management

**FR-1: Salon Sign-Up & Onboarding**
- Why: First touchpoint; must be frictionless to drive conversion from trial to paid.
- Who: Salon Owner.
- Business Value: Directly drives acquisition and activation rates.
- Priority: **Critical**

**FR-2: Salon Profile Configuration** (name, address, hours, timezone, branding)
- Why: The AI needs accurate business data to answer customer questions correctly.
- Who: Salon Owner/Manager.
- Business Value: Determines AI answer accuracy; poor setup directly causes bad customer experience.
- Priority: **Critical**

**FR-3: Multi-Tenant Data Isolation**
- Why: Salons are independent businesses; a data leak between tenants is a critical trust and legal failure.
- Who: System-enforced, affects all roles.
- Business Value: Foundational trust requirement; a single breach could be fatal to the business.
- Priority: **Critical**

**FR-4: Staff / Team Management** (invite staff, assign roles, set individual working hours/skills)
- Why: Availability checking and booking assignment depend on accurate staff data.
- Who: Salon Owner/Manager.
- Business Value: Enables correct AI scheduling; supports team accountability.
- Priority: **Critical**

**FR-5: Service Catalog Management** (services, duration, price, staff who can perform them, category)
- Why: The AI needs a structured source of truth to recommend services and calculate booking duration.
- Who: Salon Owner/Manager.
- Business Value: Core input for AI recommendations and accurate scheduling.
- Priority: **Critical**

### 8.2 WhatsApp & AI Conversation

**FR-6: WhatsApp Business Account Connection**
- Why: The entire product is delivered through WhatsApp; without this, nothing else functions.
- Who: Salon Owner (setup), AI Agent (runtime).
- Business Value: Core delivery channel — a hard product dependency.
- Priority: **Critical**

**FR-7: AI Conversational Q&A** (answer FAQs, business info, service info)
- Why: Reduces staff time spent answering repetitive questions.
- Who: End Customer ↔ AI Agent.
- Business Value: Core value proposition; direct time savings for salons.
- Priority: **Critical**

**FR-8: AI Appointment Booking**
- Why: Primary revenue-driving action; converts inquiries into confirmed, calendar-backed appointments.
- Who: End Customer ↔ AI Agent.
- Business Value: Directly increases booked revenue and reduces missed bookings.
- Priority: **Critical**

**FR-9: AI Appointment Rescheduling**
- Why: Customers frequently need to change appointment times; manual rescheduling consumes staff time.
- Who: End Customer ↔ AI Agent.
- Business Value: Reduces no-shows/cancellations by making changes frictionless; retains revenue that might otherwise be lost.
- Priority: **High**

**FR-10: AI Appointment Cancellation**
- Why: Customers need a simple way to cancel; early cancellation lets the slot be resold.
- Who: End Customer ↔ AI Agent.
- Business Value: Frees calendar slots for rebooking; reduces revenue loss from unclaimed no-shows.
- Priority: **High**

**FR-11: Employee Availability Checking**
- Why: Required to offer only valid, bookable time slots.
- Who: AI Agent (internal tool call), indirectly End Customer.
- Business Value: Prevents double-booking and scheduling conflicts, protecting salon operations.
- Priority: **Critical**

**FR-12: AI Service Recommendation**
- Why: Customers often don't know the exact service name; guided recommendation increases booking completion.
- Who: End Customer ↔ AI Agent.
- Business Value: Increases average booking value and conversion (upsell/cross-sell potential).
- Priority: **High**

**FR-13: Human Handoff / Escalation**
- Why: AI cannot and should not handle every scenario (complaints, complex requests, payment disputes); trust requires a human fallback.
- Who: AI Agent → Salon Staff.
- Business Value: Protects customer experience and salon reputation; a mandatory trust/safety mechanism, not optional.
- Priority: **Critical**

**FR-14: Conversation History & Context**
- Why: AI needs prior conversation context to avoid repetitive/contradictory answers; staff need visibility for handoffs.
- Who: AI Agent, Salon Staff.
- Business Value: Improves AI quality and enables staff to pick up conversations without re-asking the customer.
- Priority: **High**

**FR-15: Appointment Reminders & Notifications**
- Why: Reduces no-show rate, a major source of lost salon revenue.
- Who: AI Agent (automated) → End Customer.
- Business Value: Directly reduces no-show revenue loss; a well-known high-ROI feature in booking systems.
- Priority: **High**

**FR-16: Multi-Language Conversation Support**
- Why: Salons often serve customers in more than one language depending on region.
- Who: End Customer ↔ AI Agent.
- Business Value: Expands addressable customer base per salon; important for target geographies.
- Priority: **Medium**

### 8.3 Calendar & Booking Management (Human-Facing)

**FR-17: Booking Dashboard / Calendar View**
- Why: Staff and owners need visibility into what the AI has booked, in a familiar calendar format.
- Who: Salon Owner/Manager/Staff.
- Business Value: Operational necessity; trust-building (owners must be able to verify AI actions).
- Priority: **Critical**

**FR-18: Manual Booking Creation/Edit by Staff**
- Why: Not all bookings originate from WhatsApp (walk-ins, phone calls); staff need manual control and override capability.
- Who: Salon Owner/Manager/Staff.
- Business Value: Ensures the calendar remains the single source of truth even for non-AI bookings.
- Priority: **High**

**FR-19: Booking Conflict Prevention**
- Why: Double-booked staff is a critical operational failure that damages customer trust.
- Who: System-enforced.
- Business Value: Protects service quality and staff scheduling integrity.
- Priority: **Critical**

### 8.4 Subscription & Billing

**FR-20: Subscription Plan Management** (plan tiers, upgrade/downgrade)
- Why: Core monetization mechanism of the SaaS.
- Who: Salon Owner, Super Admin.
- Business Value: Direct revenue driver; enables tiered pricing/packaging strategy.
- Priority: **Critical**

**FR-21: Stripe-Based Payment Processing**
- Why: Automates recurring billing; industry-standard, PCI-compliant payment handling.
- Who: Salon Owner (payer), system (automated).
- Business Value: Removes manual invoicing overhead; enables reliable recurring revenue collection.
- Priority: **Critical**

**FR-22: Usage Limits & Plan Enforcement** (e.g., message volume, staff count, number of AI conversations per plan tier)
- Why: Aligns cost-to-serve (OpenAI/WhatsApp API costs scale with usage) with pricing tiers.
- Who: System-enforced, visible to Salon Owner.
- Business Value: Protects unit economics; prevents low-tier tenants from consuming disproportionate AI/API costs.
- Priority: **Critical**

**FR-23: Billing History & Invoices**
- Why: Standard SaaS requirement for transparency and accounting/tax purposes.
- Who: Salon Owner.
- Business Value: Reduces support burden; required for business bookkeeping compliance.
- Priority: **Medium**

**FR-24: Trial Period / Free Tier**
- Why: Lowers barrier to adoption; lets salons validate value before committing to payment.
- Who: Salon Owner.
- Business Value: Improves top-of-funnel conversion.
- Priority: **High**

**FR-25: Dunning / Failed Payment Handling**
- Why: Payment failures are common (expired cards); needs a graceful retry/notification flow before service suspension.
- Who: System, Salon Owner.
- Business Value: Reduces involuntary churn, a major SaaS revenue leak.
- Priority: **High**

### 8.5 Platform Administration

**FR-26: Super Admin Tenant Management** (view/suspend/support tenants)
- Why: Platform operator needs oversight and support tooling across all customers.
- Who: Super Admin.
- Business Value: Enables support operations, abuse prevention, and platform health monitoring.
- Priority: **High**

**FR-27: Platform-Wide Monitoring & Analytics** (AI usage, conversation volume, error rates per tenant)
- Why: Needed to manage OpenAI/WhatsApp API cost exposure and detect issues proactively.
- Who: Super Admin.
- Business Value: Protects margins and product reliability; informs pricing decisions.
- Priority: **High**

**FR-28: Audit Logging** (who did what, when — especially for AI actions on bookings)
- Why: When an AI books/cancels/reschedules incorrectly, staff need to trace what happened.
- Who: Salon Owner/Manager, Super Admin.
- Business Value: Builds trust in AI actions; essential for dispute resolution and debugging.
- Priority: **High**

### 8.6 AI Configuration & Guardrails

**FR-29: AI Behavior Configuration** (tone, greeting message, escalation rules, business-specific instructions)
- Why: Salons need the AI to sound "on-brand" and follow salon-specific policies (e.g., cancellation window).
- Who: Salon Owner/Manager.
- Business Value: Differentiator vs. generic chatbots; increases perceived quality and trust.
- Priority: **High**

**FR-30: AI Guardrails** (prevent hallucinated bookings, restrict AI to defined tool actions, confirm before destructive actions like cancellation)
- Why: Prevents AI from taking incorrect or unauthorized actions (e.g., inventing services/prices, canceling wrong appointments).
- Who: System-enforced, protects End Customer and Salon Owner.
- Business Value: Critical trust and liability control; prevents reputational and financial damage from AI errors.
- Priority: **Critical**

---

## 9. Non-Functional Requirements

| Category | Requirement | Priority |
|---|---|---|
| **Multi-Tenancy & Isolation** | Complete logical data isolation between tenants at the database and application layer; no tenant may access another tenant's data under any code path. | Critical |
| **Security** | Encryption in transit (TLS) and at rest for sensitive data; secure secret management for API keys (OpenAI, WhatsApp, Stripe); role-based access control enforced server-side. | Critical |
| **Availability** | The WhatsApp AI receptionist must target high uptime (e.g., 99.5%+) since it directly replaces a salon's front desk — downtime equals lost bookings. Target SLA to be finalized with business (Section 22). | Critical |
| **Scalability** | Architecture must support growth from tens to thousands of tenants without redesign; must handle concurrent AI conversations across many tenants simultaneously. | High |
| **Performance** | AI response latency to a customer WhatsApp message should feel conversational (target: low single-digit seconds end-to-end). Slow responses directly harm the core value proposition. | Critical |
| **Reliability of AI Actions** | Booking/reschedule/cancel actions performed by the AI must be atomic and consistent — no double-bookings, no lost bookings, no ghost cancellations. | Critical |
| **Data Backup & Recovery** | Regular automated backups of tenant data (bookings, conversations, configuration) with a defined recovery point/time objective. | Critical |
| **Auditability** | All AI-initiated booking actions must be logged with enough detail to reconstruct what happened and why. | High |
| **Observability** | Centralized logging, error tracking, and monitoring/alerting for system health and AI failures across tenants. | High |
| **Cost Predictability** | Usage of paid third-party APIs (OpenAI, WhatsApp Cloud API) must be tracked per tenant to control margin and enable plan-based limits. | High |
| **Localization** | Support multiple languages and timezones, since target markets are not English-only. | Medium |
| **Maintainability** | Codebase organized to support a fixed, opinionated stack (NestJS/Angular/Prisma) with clear module boundaries per domain (tenants, bookings, AI, billing, messaging). | High |
| **Accessibility** | Admin web dashboard should meet reasonable accessibility standards (WCAG 2.1 AA as a target) since salon owners are not necessarily tech-savvy. | Medium |
| **Portability of Infrastructure** | Must run reliably on self-managed Hetzner VPS via Docker Compose — no dependency on a specific cloud provider's managed services. | High |

---

## 10. Core Features

Core features are the features required for the product to deliver its primary value proposition and be commercially viable at launch. Each is listed with rationale.

1. **WhatsApp AI Receptionist Conversation Engine** — the product's core differentiator; without it there is no product.
2. **Appointment Booking, Rescheduling, Cancellation via AI** — the primary revenue-protecting actions customers need.
3. **Employee Availability Engine** — required for accurate, conflict-free booking.
4. **Service Catalog & Recommendation** — enables the AI to guide customers to the right service.
5. **Human Handoff** — mandatory trust/safety mechanism; no serious business will adopt an AI receptionist without an escape hatch to a human.
6. **Multi-Tenant Salon Management Dashboard** — where salons configure everything the AI relies on.
7. **Subscription Billing (Stripe)** — required for the business to generate revenue.
8. **Booking Calendar for Staff** — operational necessity and trust-verification tool for salon staff.
9. **Notifications/Reminders** — directly reduces no-shows, a top salon pain point.
10. **AI Guardrails & Configuration** — required to keep AI actions safe, on-brand, and legally defensible.

---

## 11. Future Features

Features valuable to the vision but **not required for initial commercial launch**:

| Feature | Why Deferred |
|---|---|
| Voice-call AI receptionist (phone, not just WhatsApp) | Different channel/technology (telephony); large scope addition. |
| Instagram/Facebook Messenger channel support | Expands channel coverage but WhatsApp is the primary/proven channel for target markets. |
| AI-driven marketing campaigns (e.g., automated win-back messages) | Valuable growth feature but not core to receptionist function; needs WhatsApp marketing-template compliance work. |
| Customer loyalty/rewards program | Adds business value but is a distinct product surface from receptionist automation. |
| Native mobile app for salon owners | Web dashboard covers initial need; mobile app is a UX enhancement, not a functional requirement. |
| Advanced business analytics/BI (revenue forecasting, staff performance insights) | Valuable but secondary to core booking automation; needs a mature data set to be useful. |
| Payment collection via WhatsApp (deposits, in-chat payment) | Adds Stripe complexity (payment links, deposit policies) beyond initial billing scope. |
| Multi-location / franchise management console | Needed only once multi-location customer demand is validated. |
| Marketplace/directory of salons for consumer discovery | Different business model surface (B2C acquisition channel) from the core B2B SaaS. |
| White-labeling for reseller/agency partners | Relevant only after core product-market fit is established. |

---

## 12. MVP Scope

The MVP is the smallest version of the product that delivers the core value proposition (AI books/manages appointments over WhatsApp with proper tenant isolation and billing) to a paying salon.

**Included in MVP:**
- Salon sign-up, onboarding, and profile configuration (FR-1, FR-2)
- Multi-tenant data isolation (FR-3)
- Staff management (basic: add staff, set working hours) (FR-4)
- Service catalog management (FR-5)
- WhatsApp Business Cloud API connection per tenant (FR-6)
- AI conversational Q&A grounded in salon profile/services/FAQs (FR-7)
- AI booking, rescheduling, cancellation (FR-8, FR-9, FR-10)
- Employee availability checking (FR-11)
- Basic AI service recommendation (FR-12)
- Human handoff (FR-13)
- Conversation history (FR-14)
- Appointment reminders (single reminder, e.g., 24h before) (FR-15)
- Booking calendar dashboard (FR-17)
- Manual booking creation by staff (FR-18)
- Booking conflict prevention (FR-19)
- Subscription plans + Stripe billing (single currency) (FR-20, FR-21)
- Plan-based usage limits (FR-22)
- Trial period (FR-24)
- Failed payment handling (basic dunning) (FR-25)
- AI behavior configuration (basic: greeting, tone, escalation triggers) (FR-29)
- AI guardrails (booking confirmation, restricted tool actions) (FR-30)
- Super Admin: basic tenant visibility and support tools (FR-26)
- Audit logging for AI booking actions (FR-28)

**Explicitly deferred past MVP (see Section 11 and 13):**
- Multi-language support (Medium priority — nice-to-have for MVP but can launch single-language first if target market allows)
- Multi-location management
- Advanced analytics/BI
- Voice channel, Instagram/Messenger channels
- In-chat payments
- White-labeling

---

## 13. Out-of-Scope Features

The following are explicitly **out of scope** for the foreseeable roadmap unless a future business decision changes direction:

- Point-of-sale (POS) / inventory management — this is a scheduling/communication product, not a full salon-management ERP.
- Payroll or staff commission calculation.
- Native e-commerce/product sales (retail product purchasing).
- On-premise/self-hosted deployment for individual customers (platform is SaaS-only, operated by us).
- Support for messaging channels other than WhatsApp (at least through MVP and near-term roadmap).
- Building a custom telephony/voice IVR system.
- Building a custom-built LLM (the platform uses OpenAI's API, not a self-hosted model).

---

## 14. User Journeys

### 14.1 Salon Owner Onboarding Journey
1. Owner signs up on the marketing site / web app.
2. Owner creates their salon profile (name, address, hours, timezone).
3. Owner selects a subscription plan (or starts free trial) and enters payment details via Stripe.
4. Owner connects their WhatsApp Business number via the WhatsApp Cloud API setup flow.
5. Owner adds staff members and their working hours.
6. Owner adds services (name, duration, price, which staff can perform them).
7. Owner configures AI behavior (greeting message, tone, business-specific rules e.g. cancellation policy).
8. Owner sends a test message to their own WhatsApp number to validate the AI is working.
9. Salon goes live — the WhatsApp number is now actively handled by the AI.

### 14.2 Customer Booking Journey (Happy Path)
1. Customer messages the salon's WhatsApp number: "Hi, do you have anything available for a haircut this Saturday?"
2. AI greets the customer, checks service catalog and staff availability.
3. AI proposes available time slots matching the requested service and day.
4. Customer selects a slot.
5. AI confirms details (service, staff, date/time, price) and books the appointment.
6. AI sends a booking confirmation message.
7. AI sends an automated reminder message ahead of the appointment (e.g., 24 hours prior).

### 14.3 Customer Reschedule Journey
1. Customer messages: "I need to move my appointment tomorrow to next week."
2. AI retrieves the customer's upcoming appointment(s) from conversation/booking context.
3. AI checks new availability based on customer's preferred new time.
4. AI confirms the new slot and updates the booking, cancelling the old slot.
5. AI sends updated confirmation.

### 14.4 Human Handoff Journey
1. Customer asks something outside the AI's defined scope (e.g., a complaint, a custom request the AI can't resolve, or explicitly asks for a human).
2. AI recognizes the escalation trigger (per FR-13/FR-30 guardrails) and notifies salon staff (e.g., dashboard alert / internal notification).
3. AI informs the customer a team member will follow up (or, if configured, pauses AI auto-response on that conversation).
4. Salon staff member views the conversation history in the dashboard and takes over via WhatsApp directly (or via an in-dashboard reply, depending on final architecture decision — see Section 22).

### 14.5 Salon Owner Monitoring Journey
1. Owner logs into the dashboard.
2. Owner views today's/week's bookings on the calendar.
3. Owner reviews any conversations flagged for human handoff.
4. Owner reviews subscription/billing status and usage against plan limits.

### 14.6 Subscription Lifecycle Journey
1. Salon signs up for a free trial.
2. System notifies owner as trial nears expiration.
3. Owner enters payment method; Stripe processes the subscription charge.
4. On successful payment, plan limits are applied and enforced.
5. On failed payment, dunning flow triggers (retry attempts + notifications) before eventual service suspension if unresolved.

---

## 15. Business Rules

1. A conversation (WhatsApp phone number) belongs to exactly one salon tenant at a time — determined by which salon's WhatsApp Business number received the message.
2. The AI may only take booking actions (create/reschedule/cancel) for the salon whose WhatsApp number the conversation is on — never across tenants.
3. The AI must not invent services, prices, or availability not present in the salon's configured data.
4. A booking may not be created if it conflicts with an existing confirmed booking for the same staff member and time window.
5. The AI must confirm booking details with the customer before finalizing a create/reschedule/cancel action (no silent destructive actions).
6. Cancellation/rescheduling policies (e.g., minimum notice period) are configurable per salon and must be enforced by the AI in conversation.
7. A salon exceeding its plan's usage limits (e.g., message volume) must be handled per a defined policy (e.g., soft warning, then throttling/upgrade prompt) — exact behavior to be finalized (see Section 22).
8. Only a Salon Owner (not Manager/Staff) may change the subscription plan, cancel the subscription, or delete the salon account.
9. All AI-driven booking actions must be attributable and logged (which conversation, which customer, what action, timestamp).
10. A suspended (non-paying, post-dunning) tenant's AI receptionist must stop actively handling new conversations, per a defined grace-period policy (to be finalized).
11. Staff members can only view/manage their own calendar and assigned bookings unless granted broader permission by the Owner/Manager.

---

## 16. Assumptions

1. Salons have (or can obtain) a verified WhatsApp Business Cloud API account/number — this is a prerequisite the platform depends on but does not fully control (Meta's approval process).
2. Target markets have high WhatsApp adoption among salon customers (to be confirmed — see Section 22).
3. Salons are comfortable with an AI representing their business in customer conversations, provided guardrails and human handoff exist.
4. OpenAI API availability and performance are sufficient for near-real-time conversational use at the expected message volume.
5. Each salon operates from one or more fixed physical locations with defined business hours (not a fully mobile/on-demand service model).
6. Pricing will be structured as tiered monthly subscription plans (exact tiers/pricing TBD with business stakeholders).
7. Initial launch will support a limited set of languages, expanding based on market demand.
8. Salons will primarily interact with the platform via a web dashboard (desktop/tablet), not through a dedicated mobile app initially.

---

## 17. Risks

| Risk | Impact | Likelihood | Mitigation Direction |
|---|---|---|---|
| WhatsApp Business API policy changes or account suspension (Meta) | High — could disable a tenant's or the platform's messaging capability | Medium | Follow WhatsApp Business Policy strictly; monitor account health; have a support/appeals process. |
| AI makes an incorrect booking action (wrong time, wrong service, hallucinated info) | High — direct customer/business trust damage | Medium | Strict tool-calling guardrails, confirmation steps before destructive actions, structured outputs, audit logging (FR-30, FR-28). |
| OpenAI API cost scaling faster than subscription revenue | High — margin erosion | Medium | Usage-based plan limits (FR-22), per-tenant cost monitoring (FR-27), prompt/response optimization. |
| Data isolation failure between tenants | Critical — legal/trust catastrophe | Low (if designed correctly) | Rigorous tenant-scoping enforcement at data-access layer, security testing, code review discipline. |
| Low WhatsApp adoption in a chosen launch market | Medium — reduces addressable market | Depends on market | Validate target market WhatsApp usage before major go-to-market investment. |
| Salon owner mis-configures AI (wrong hours/services), producing bad customer experience | Medium — reflects poorly on the AI, not the owner's error | Medium | Strong onboarding UX, validation, test-message flow before go-live. |
| Over-reliance on a single AI/messaging vendor (OpenAI, Meta) | Medium — vendor outage or pricing change affects entire platform | Medium | Monitor vendor SLAs; design for possible future multi-model flexibility (not required at launch). |
| Involuntary churn from failed payments | Medium — revenue leakage | Medium | Dunning flow, proactive payment-failure notifications (FR-25). |
| Regulatory/privacy risk handling customer personal data (names, phone numbers, preferences) across many small businesses | High | Medium | Clear data-processing agreements, encryption, defined data retention policy (see Section 20). |

---

## 18. Success Metrics

| Metric | What It Measures |
|---|---|
| Monthly Recurring Revenue (MRR) | Core business health/growth. |
| Tenant Activation Rate (% of sign-ups that go live with WhatsApp connected) | Onboarding funnel effectiveness. |
| Trial-to-Paid Conversion Rate | Product value validation and pricing fit. |
| Monthly Churn Rate | Retention/product stickiness. |
| AI Booking Completion Rate (% of booking-intent conversations resulting in a confirmed booking) | Core AI effectiveness. |
| Human Handoff Rate | AI coverage/confidence — track to ensure it's neither too high (AI failing) nor suspiciously zero (guardrails not triggering). |
| No-Show Rate (pre vs. post platform adoption per salon) | Direct measurable business value delivered to customers. |
| Average AI Response Time | Core UX quality metric. |
| Cost per Conversation (OpenAI + WhatsApp API cost) | Unit economics / margin health. |
| Net Promoter Score (NPS) or CSAT from salon owners | Overall satisfaction and referral potential. |

---

## 19. Technical Constraints

These are fixed by prior decision and constrain the architecture phase:

- **Frontend:** Angular 20, TypeScript, Tailwind CSS, Angular Signals.
- **Backend:** NestJS, TypeScript, PostgreSQL, Prisma ORM, Redis (caching/queues/session, exact use TBD in architecture phase).
- **Infrastructure:** Docker, Docker Compose, self-managed Hetzner VPS (not a managed cloud PaaS), Nginx as reverse proxy/load balancer.
- **AI:** OpenAI API using Tool Calling and Structured Outputs (not a self-hosted/open-source model).
- **Messaging:** WhatsApp Business Cloud API (official Meta API, not a third-party unofficial WhatsApp integration).
- **Payments:** Stripe (subscriptions, invoicing, dunning).
- **Storage:** S3-compatible object storage (for assets such as salon images, potentially exported reports/invoices).

**Implications to resolve in the architecture phase:**
- Self-managed VPS deployment means the team is responsible for scaling, high availability, and backup strategy (no managed auto-scaling) — this must be explicitly designed.
- Multi-tenancy strategy (shared database with tenant-scoping vs. schema-per-tenant vs. database-per-tenant) must be decided against Prisma/PostgreSQL capabilities.
- Redis's role (job queue for reminders/notifications, caching AI context, rate limiting, session storage) needs explicit definition.

---

## 20. Compliance Considerations

1. **WhatsApp Business Policy Compliance** — must adhere to Meta's WhatsApp Business Messaging Policy, including template message rules for outbound notifications (e.g., reminders) sent outside the 24-hour customer service window.
2. **Data Privacy (GDPR and/or regional equivalents)** — the platform processes personal data (customer names, phone numbers, appointment history) on behalf of salons (data processor role) for salons (data controller role). Requires: a data processing agreement (DPA) with salon customers, defined data retention/deletion policy, and support for data subject access/deletion requests.
3. **Payment Card Industry (PCI) Compliance** — handled primarily via Stripe (Stripe-hosted payment flows reduce direct PCI scope), but integration must avoid ever storing raw card data on platform servers.
4. **Consent for AI Automated Messaging** — customers should be clearly informed they are interacting with an AI (per emerging regulations in various jurisdictions requiring AI-disclosure) and that automated messages (reminders) are part of the service.
5. **Data Residency** — may become a requirement depending on target markets (e.g., EU customers expecting EU-hosted data); to be clarified with business stakeholders (Section 22).
6. **Cross-Tenant Confidentiality** — beyond technical isolation (FR-3), contractual terms of service must state salon data is never shared across tenants or used to train shared models without consent.

---

## 21. High-Level System Overview

*(Narrative only — no architecture diagrams or database schema at this stage, per instruction. This section orients the reader on major system actors/flows for context ahead of the architecture phase.)*

The platform consists of three primary surfaces:

1. **Salon Web Dashboard (Angular 20)** — used by Salon Owners/Managers/Staff to configure their salon, manage staff/services, view bookings, monitor conversations, and manage billing.
2. **Backend Platform (NestJS)** — hosts all business logic: tenant management, booking engine, AI orchestration layer (tool calling against OpenAI), WhatsApp message handling (inbound/outbound via WhatsApp Business Cloud API), subscription/billing logic (Stripe integration), and enforces tenant data isolation.
3. **AI Receptionist Runtime** — the conversational layer that receives inbound WhatsApp messages per tenant, uses OpenAI Tool Calling/Structured Outputs to interpret customer intent, calls internal backend tools (check availability, create booking, reschedule, cancel, escalate), and sends responses back through the WhatsApp Business Cloud API.

Supporting infrastructure includes PostgreSQL (system of record, accessed via Prisma), Redis (for caching, queuing background jobs such as reminders, and likely rate-limiting/session needs), and S3-compatible storage (for static assets). The whole stack runs containerized via Docker Compose on a Hetzner VPS behind Nginx.

Platform Administration is a fourth, smaller surface used only by Super Admins to manage tenants and monitor platform health across all salons.

Detailed architecture (multi-tenancy strategy, service boundaries, queueing design, database schema, deployment topology, scaling plan) will be defined in the next phase, after this requirements document is approved.

---

## 22. Questions or Ambiguities That Need Clarification

These must be resolved before or during the architecture phase, as they materially affect design decisions:

1. **Target launch market(s)** — Which specific country/region launches first? This affects language priority, WhatsApp adoption assumptions, timezone handling, and data residency requirements.
2. **Pricing/plan tiers** — How many subscription tiers, what differentiates them (message volume? staff count? number of locations? AI features?), and what is the trial length?
3. **Multi-location support at MVP or later** — Is a single salon-to-single-WhatsApp-number model correct for MVP, or do some target customers need multiple locations under one account from day one?
4. **Human handoff mechanism** — When the AI hands off to a human, does staff reply directly from their own WhatsApp app, or through an in-dashboard chat interface? This significantly affects scope (a full in-dashboard messaging UI vs. a simpler notification-only flow).
5. **AI disclosure requirement** — Should/must customers always be told upfront they're talking to an AI (regulatory and trust question), and is this configurable per salon or mandatory platform-wide?
6. **Data residency requirements** — Do target markets/customers require data to be hosted in a specific region (e.g., EU-only hosting)?
7. **Definition of "usage" for plan limits** — Is it number of conversations, number of messages, number of bookings, number of staff, or a combination? This drives FR-22 design and Stripe metering setup.
8. **SLA commitment** — What uptime/response-time SLA (if any) will be contractually promised to paying salons, especially given a self-managed VPS deployment (no managed cloud auto-failover)?
9. **What happens to in-flight AI conversations when a subscription lapses/is suspended?** — Immediate cutoff, grace period, or read-only mode?
10. **Ownership of the WhatsApp Business number** — Does the salon bring their own existing WhatsApp Business number, or does the platform provision numbers on the salon's behalf? This significantly affects onboarding complexity and Meta's approval workflow.
11. **Cancellation/no-show policy enforcement** — Should the AI be able to enforce cancellation fees or deposits (which would require payment collection in-chat, currently out of scope per Section 11), or purely enforce a notice-period policy conversationally?
12. **Staff skill-matching granularity** — Is a "staff member can perform service X" flag sufficient, or is more granular skill/certification tracking needed (affecting FR-4/FR-5/FR-11 design)?
13. **Multi-language scope for MVP** — Is single-language launch acceptable, or is multi-language a hard MVP requirement given the target market(s) identified in Q1?
14. **Branding/white-label expectations** — Will the AI ever refer to itself by a salon-specific name/persona, or always as a generic "assistant"? Affects FR-29 configuration depth.
15. **Support model** — What support channel/SLA will salon owners get (email, chat, phone) and does the Super Admin tooling (FR-26/FR-27) need to support a support team, not just engineering?

---

## Document Status & Next Steps

This document defines **requirements only**. Per instruction, no code, architecture diagrams, or database schema have been produced.

**Recommended next step:** Review Section 22 (Questions/Ambiguities) together, resolve as many as possible, then proceed to the **Architecture Phase**, covering: multi-tenancy strategy, system/module boundaries, database schema design, AI orchestration design (tool-calling contract), deployment topology on Hetzner, and scaling/observability plan.

**Awaiting your approval before proceeding.**
