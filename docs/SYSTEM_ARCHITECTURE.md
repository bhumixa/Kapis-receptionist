# SYSTEM_ARCHITECTURE.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### System Architecture Document

**Document Status:** Draft for Approval
**Version:** 1.0
**Depends on:** PROJECT_REQUIREMENTS.md (v1.0)
**Scope:** Architecture only — no application code, no database schema, no API contracts. These follow in subsequent phases pending approval of this document.

---

## 1. High-Level Architecture

### 1.1 Overview

The platform is a **modular monolith** backend (NestJS) serving a **single-page Angular application** (salon dashboard) and acting as the orchestration hub for all external integrations: OpenAI (AI reasoning), WhatsApp Cloud API (customer messaging), Stripe (billing), an email service (transactional email), and S3-compatible storage (file assets). PostgreSQL is the single system of record; Redis serves as cache, queue broker, and ephemeral state store. Everything runs containerized behind Nginx on a Hetzner VPS.

There is exactly **one trust boundary that matters most**: tenant (salon) isolation. Every component in this architecture is designed around the assumption that a request, message, or background job carries a `tenantId` that must be validated and enforced at every layer — API, service, and data access.

### 1.2 Component Interaction Narrative

```
                                    ┌─────────────────────┐
                                    │   Salon Owner /      │
                                    │   Staff (Browser)    │
                                    └──────────┬───────────┘
                                               │ HTTPS
                                               ▼
                                    ┌─────────────────────┐
                                    │        Nginx         │
                                    │  (TLS termination,   │
                                    │  reverse proxy,      │
                                    │  static asset serve) │
                                    └──────────┬───────────┘
                              ┌────────────────┴────────────────┐
                              ▼                                 ▼
                 ┌───────────────────────┐          ┌────────────────────────┐
                 │  Angular 20 SPA       │          │   NestJS Backend        │
                 │  (static build,       │  REST/   │   (Modular Monolith)    │
                 │  served by Nginx)     │  JSON    │                         │
                 └───────────────────────┘◄─────────┤  - Auth & RBAC          │
                                                     │  - Tenant context       │
                                                     │  - Booking engine       │
                                                     │  - AI orchestration     │
                                                     │  - WhatsApp gateway     │
                                                     │  - Billing (Stripe)     │
                                                     │  - Notifications        │
                                                     └───┬───┬───┬───┬───┬────┘
                                                         │   │   │   │   │
                          ┌──────────────────────────────┘   │   │   │   └──────────────────┐
                          ▼                                  ▼   │   ▼                       ▼
                 ┌────────────────┐                ┌──────────┐ │ ┌──────────┐   ┌────────────────────┐
                 │  PostgreSQL     │                │  Redis   │ │ │  OpenAI  │   │  S3-Compatible      │
                 │  (via Prisma)   │                │ (cache,  │ │ │  API     │   │  Storage             │
                 │  System of      │                │  queues, │ │ │ (Tool    │   │  (media, exports,    │
                 │  record         │                │  rate    │ │ │  Calling)│   │  branding assets)    │
                 └────────────────┘                │  limit)  │ │ └──────────┘   └────────────────────┘
                                                     └──────────┘ │
                                                                  ▼
                                                        ┌──────────────────┐
                                                        │  WhatsApp Cloud   │
                                                        │  API (Meta)       │
                                                        └────────┬──────────┘
                                                                 │
                                                                 ▼
                                                        ┌──────────────────┐
                                                        │  End Customer     │
                                                        │  (WhatsApp app)   │
                                                        └──────────────────┘

                          ┌──────────────────┐          ┌──────────────────┐
                          │  Stripe           │          │  Email Service    │
                          │  (billing/        │          │  (transactional:  │
                          │  webhooks)        │          │  verification,    │
                          └──────────────────┘          │  password reset,  │
                                                          │  receipts)        │
                                                          └──────────────────┘
```

### 1.3 Component Responsibilities

**Frontend (Angular 20 SPA)**
- Renders the salon-facing dashboard: onboarding, staff/service management, booking calendar, conversation monitoring, billing, settings.
- Never talks directly to OpenAI, WhatsApp, or Stripe — always goes through the NestJS backend, which owns all secrets and business rules.
- Consumes a single backend REST API; holds no tenant data beyond what's needed for the current session.

**Backend (NestJS Modular Monolith)**
- Single source of truth for business logic: authentication, tenant resolution, booking rules, AI tool execution, WhatsApp message handling, billing state, notifications.
- Owns every external integration credential (OpenAI key, WhatsApp tokens, Stripe keys, S3 credentials, SMTP/email provider keys) — the frontend and end customers never interact with these directly.
- Enforces tenant isolation on every request and every background job.

**Database (PostgreSQL via Prisma)**
- System of record for all persistent tenant data: salons, users, staff, services, appointments, conversations, messages, subscriptions, audit logs.
- Prisma provides the type-safe data access layer and migration tooling shared by all backend modules.

**Redis**
- Cache for frequently-read, rarely-changed data (e.g., salon configuration used by the AI on every message, availability lookups).
- Broker for background job queues (BullMQ or equivalent): outbound WhatsApp messages, reminders, webhook processing, email sending.
- Store for rate limiting counters, idempotency keys (WhatsApp webhook dedup, Stripe webhook dedup), and short-lived session/auth artifacts (e.g., refresh token rotation tracking).

**OpenAI (AI reasoning layer)**
- Receives conversation context + tool definitions from the AI module; returns either a structured response or a tool-call instruction (Tool Calling + Structured Outputs).
- Never receives more than the current tenant's data — the backend constructs a tenant-scoped context per call; OpenAI has no persistent memory of its own.

**WhatsApp Cloud API**
- Inbound channel: delivers customer messages to the backend via webhook.
- Outbound channel: the backend sends AI/staff responses, booking confirmations, and reminders through it.
- One WhatsApp Business phone number is mapped to exactly one tenant.

**Stripe**
- Owns subscription billing: plan management, payment collection, invoicing, dunning.
- Sends webhooks (payment succeeded/failed, subscription updated/cancelled) that the backend consumes to update tenant plan/usage state.

**Email Service** (transactional provider — e.g., a service reachable via SMTP or HTTP API; specific vendor is an infrastructure choice, not fixed by the stack)
- Sends account-level transactional email: email verification, password reset, invoice/receipt copies, critical alerts (e.g., payment failure, WhatsApp disconnection).
- Decoupled behind a `Notifications` module abstraction so the vendor can be swapped without touching business logic.

**File Storage (S3-Compatible)**
- Stores salon branding assets (logos), any customer-submitted media relayed through WhatsApp (e.g., a reference photo for a service), and generated exports (invoices, reports).
- Backend issues pre-signed URLs for upload/download rather than proxying large binary payloads through the API process where avoidable.

### 1.4 Request Flow Examples

**A. Salon owner views the booking calendar**
Browser → Nginx → Angular static assets served once, then SPA calls backend API → Nginx reverse-proxies to NestJS → Auth guard validates JWT → Tenant context resolved → Appointments module queries PostgreSQL scoped to `tenantId` → response returned as JSON → Angular renders calendar.

**B. Customer books an appointment via WhatsApp**
Customer sends WhatsApp message → Meta delivers webhook to NestJS `WhatsApp` module → message enqueued in Redis for processing → worker resolves tenant from the receiving phone number → `Conversations`/`Messages` modules persist the message → `AI` module builds context (salon config, service catalog, conversation history) → calls OpenAI with tool definitions → OpenAI returns a tool call (e.g., `checkAvailability`, then `createAppointment`) → backend executes the tool against the `Availability`/`Appointments` modules (real business logic, not OpenAI) → result returned to OpenAI for a natural-language confirmation → response enqueued for outbound send → `WhatsApp` module sends confirmation to customer via Cloud API.

**C. Subscription payment fails**
Stripe attempts a renewal charge → fails → Stripe sends a webhook → NestJS `Billing` module verifies webhook signature → updates tenant subscription status → triggers `Notifications` module → email sent to salon owner → if unresolved after configured retries, tenant is moved toward a suspended state per business rules.

---

## 2. Application Architecture

### 2.1 Architectural Style: Modular Monolith with Clean Architecture Principles

The backend is a **single deployable NestJS application** internally organized into **strictly bounded modules**, each structured using **Clean Architecture layering**:

```
Module
 ├── domain/          → entities, value objects, domain rules (framework-agnostic)
 ├── application/      → use cases / services, orchestrates domain + ports
 ├── infrastructure/   → Prisma repositories, external API clients, adapters
 └── interface/        → controllers, DTOs, guards (HTTP boundary)
```

**Dependency Rule:** dependencies point inward. `interface` depends on `application`, `application` depends on `domain`, `infrastructure` implements interfaces (ports) defined by `domain`/`application`. Domain logic never imports Prisma, Nest decorators, or HTTP concerns directly — it depends on abstractions (repository interfaces, ports) that infrastructure fulfills. This keeps business rules (e.g., "an appointment cannot double-book a staff member") testable and independent of NestJS or PostgreSQL specifics.

### 2.2 Why Modular Monolith (Not Microservices) at This Stage

| Factor | Modular Monolith | Microservices |
|---|---|---|
| Team size | Appropriate for a small-to-mid engineering team; one deployable to reason about | Requires dedicated ownership per service to avoid coordination overhead |
| Operational complexity | Single Docker Compose stack, single CI/CD pipeline, single set of logs/metrics to correlate | Requires service discovery, distributed tracing, inter-service auth, multiple pipelines |
| Transactional integrity | Booking logic (availability check + conflict prevention + creation) can use a single PostgreSQL transaction | Cross-service transactions require sagas/eventual consistency — much harder to get right for booking conflict prevention, a Critical requirement |
| Latency | In-process module calls are effectively free | Network hops between services add latency, directly hurting the "conversational" AI response-time NFR |
| Infrastructure cost | Fits a single Hetzner VPS (or a small fleet) per NFR constraints | Typically needs orchestration (Kubernetes) to be operable — not part of the fixed stack at this stage |
| Deployment risk | One artifact to version and roll back | Many artifacts, versioning/compatibility matrix overhead |
| Future flexibility | Clean module boundaries make future extraction straightforward if/when a module's scale profile diverges (e.g., AI/WhatsApp processing under heavy load) | N/A — already paid the cost upfront |

**Conclusion:** Microservices solve organizational and independent-scaling problems this product does not yet have. The modular monolith gives correctness guarantees (ACID transactions across booking logic) and operational simplicity that directly serve the NFRs (reliability of AI actions, booking conflict prevention) while the strict module boundaries preserve the *option* to extract a module into its own service later (Section 11.7) without a rewrite.

### 2.3 Domain Boundaries

Domain boundaries are drawn around business capabilities, matching the module list in Section 3:

- **Identity & Access** — Auth, Users, Tenants, Admin
- **Salon Operations** — Employees, Customers, Services, Appointments, Availability
- **Conversational AI** — Conversations, Messages, AI, WhatsApp
- **Commerce** — Billing
- **Platform Services** — Notifications, Files, Audit Logs, Settings, Dashboard

Each boundary owns its own data access (no module reaches into another module's Prisma models directly — it calls the owning module's public service/application layer). This is enforced by convention and code review at this stage (a single Prisma schema is still shared physically, but access is logically partitioned per module — see Section 8 for tenant-level enforcement).

### 2.4 Dependency Flow

- **Interface layer** (controllers) → **Application layer** (use-case services) → **Domain layer** (entities/business rules) ← implemented via ports ← **Infrastructure layer** (Prisma repos, OpenAI client, WhatsApp client, Stripe client, S3 client).
- Cross-module communication happens through each module's **public application service** (exported provider), never through reaching into another module's repository or domain internals.
- Shared, cross-cutting concerns (tenant context, current user, correlation IDs) flow via a request-scoped **Context** that is injected, not passed manually through every function signature.
- No circular module dependencies are permitted; module dependency graph must remain a DAG (enforced via NestJS module imports and lint rules).

### 2.5 Why This Architecture Is Appropriate

It matches the actual constraints of this project: a fixed, self-managed infrastructure budget (Hetzner VPS, not a cloud-native orchestration platform), a requirement for strong transactional correctness around booking (a Critical NFR), a small team building a v1 production SaaS (not yet at the scale where service-per-team ownership matters), and a strong desire to keep the door open for future extraction. Clean Architecture layering inside each module ensures that as the system grows, business rules remain testable and swappable independent of NestJS/Prisma specifics — reducing long-term maintenance risk without paying the distributed-systems tax on day one.

---

## 3. Backend Architecture

### 3.1 Module List

Auth · Users · Tenants · Employees · Customers · Services · Appointments · Availability · Conversations · Messages · AI · WhatsApp · Billing · Notifications · Dashboard · Settings · Audit Logs · Files · Admin

Plus two cross-cutting, non-domain infrastructure modules: **Core** (tenant context, request lifecycle, shared guards/interceptors/pipes) and **Common** (shared DTOs/utilities/decorators with no business logic).

### 3.2 Module Details

---

#### **Core** (cross-cutting, not a domain module)
**Purpose:** Provide the shared request-lifecycle infrastructure every other module depends on: tenant context resolution, correlation IDs, global exception handling, global validation pipe, and the base guard/interceptor set.
**Responsibilities:** Resolve `tenantId` and `currentUser` from the authenticated request and attach to a request-scoped context; provide global exception filters that normalize error responses; provide a global logging interceptor tagging every log line with tenant/correlation IDs.
**Dependencies:** None (foundational — every other module depends on Core, not vice versa).
**Public APIs:** `TenantContextService` (read current tenant/user within request scope), base `TenantScopedGuard`, global filters/interceptors registered at bootstrap.

---

#### **Auth**
**Purpose:** Authenticate users and issue/validate credentials for the web dashboard.
**Responsibilities:** Login (email/password), JWT issuance, refresh-token rotation, Google OAuth flow, password reset flow, email verification flow, logout/session revocation. Does **not** own role/permission definitions (see Users) — it authenticates identity only.
**Dependencies:** Users (to look up credentials/identity), Notifications (to send verification/reset emails), Tenants (to know which tenant(s) a user belongs to).
**Public APIs:** `AuthService` — login, refreshToken, initiatePasswordReset, completePasswordReset, verifyEmail, googleOAuthCallback, logout.

---

#### **Users**
**Purpose:** Manage platform user accounts and their role assignments within a tenant.
**Responsibilities:** User CRUD (Owner/Manager/Staff), role assignment, profile management, invitation flow (invite staff by email), user-to-tenant membership.
**Dependencies:** Tenants (membership scoping), Notifications (invite emails).
**Public APIs:** `UsersService` — createUser, inviteUser, updateRole, deactivateUser, getUsersForTenant, getUserById.

---

#### **Tenants**
**Purpose:** Represent the salon account itself — the root of multi-tenancy.
**Responsibilities:** Tenant creation (sign-up), tenant profile (name, address, hours, timezone, branding), tenant lifecycle state (trial, active, suspended, cancelled), tenant-level configuration flags (feature access per plan).
**Dependencies:** Billing (plan/subscription state), Files (branding asset storage).
**Public APIs:** `TenantsService` — createTenant, getTenantProfile, updateTenantProfile, getTenantStatus, suspendTenant, reactivateTenant.

---

#### **Employees**
**Purpose:** Manage salon staff as schedulable resources (distinct from `Users`, which is about platform login access — an Employee may or may not have a `User` login).
**Responsibilities:** Staff records, working hours/shifts, skills/service assignments (which services a staff member can perform), employee status (active/on leave).
**Dependencies:** Tenants (scoping), Services (skill mapping), Users (optional link to login account).
**Public APIs:** `EmployeesService` — createEmployee, updateWorkingHours, assignServices, getEmployeesForTenant, getEmployeeById.

---

#### **Customers**
**Purpose:** Represent the salon's end customers (the people booking appointments via WhatsApp), scoped per tenant.
**Responsibilities:** Customer profile (name, phone number, notes), customer history (linked appointments/conversations), deduplication by phone number within a tenant.
**Dependencies:** Tenants (scoping), Conversations (linkage), Appointments (booking history).
**Public APIs:** `CustomersService` — findOrCreateByPhone, updateCustomerProfile, getCustomerHistory, getCustomersForTenant.

---

#### **Services**
**Purpose:** Manage the salon's service catalog — the structured data the AI relies on for booking and recommendations.
**Responsibilities:** Service CRUD (name, duration, price, category, description), staff-to-service eligibility (in coordination with Employees), active/inactive status.
**Dependencies:** Tenants (scoping), Employees (eligibility mapping).
**Public APIs:** `ServicesService` — createService, updateService, deactivateService, getServiceCatalog, getServiceById.

---

#### **Appointments**
**Purpose:** Own the booking lifecycle — the single most business-critical module.
**Responsibilities:** Create/reschedule/cancel appointments; enforce conflict prevention (no double-booking a staff member); enforce cancellation/reschedule policy rules (e.g., minimum notice); maintain appointment status (confirmed, completed, cancelled, no-show); expose booking state for the dashboard calendar.
**Dependencies:** Tenants (scoping), Employees (staff being booked), Services (duration/price), Customers (who's booking), Availability (slot validation), Audit Logs (action tracking), Notifications (confirmation triggers).
**Public APIs:** `AppointmentsService` — createAppointment, rescheduleAppointment, cancelAppointment, getAppointmentsForTenant, getAppointmentById, markCompleted, markNoShow.

---

#### **Availability**
**Purpose:** Compute bookable time slots given staff working hours, existing appointments, and service duration — the engine both the AI and the dashboard rely on to avoid conflicts.
**Responsibilities:** Slot computation per employee/service/date range; conflict detection (used internally by Appointments before commit); buffer-time rules between appointments (if configured).
**Dependencies:** Employees (working hours), Appointments (existing bookings), Services (duration).
**Public APIs:** `AvailabilityService` — getAvailableSlots(employeeId/serviceId/dateRange), isSlotAvailable(proposedBooking).

---

#### **Conversations**
**Purpose:** Represent a WhatsApp conversation thread between a customer and a tenant.
**Responsibilities:** Conversation lifecycle (open, AI-handled, escalated/handed off, closed), linking a conversation to a `Customer` and `Tenant`, tracking handoff state.
**Dependencies:** Tenants (scoping), Customers (participant), Messages (content), AI (handoff triggers).
**Public APIs:** `ConversationsService` — getOrCreateConversation(phoneNumber, tenantId), markEscalated, markResolved, getConversationHistory, getActiveConversationsForTenant.

---

#### **Messages**
**Purpose:** Persist and retrieve individual inbound/outbound WhatsApp messages.
**Responsibilities:** Message storage (content, direction, sender, timestamp, delivery status, media references), message history retrieval for AI context building and staff review.
**Dependencies:** Conversations (parent thread), Files (media attachments).
**Public APIs:** `MessagesService` — recordInboundMessage, recordOutboundMessage, updateDeliveryStatus, getMessagesForConversation.

---

#### **AI**
**Purpose:** Orchestrate the conversational reasoning layer — the "brain" that decides what to say and which tools to call, without itself performing business logic.
**Responsibilities:** Build tenant-scoped context (salon profile, service catalog, conversation history) per inbound message; call OpenAI with defined tools and structured output schemas; interpret tool-call responses and dispatch to the appropriate domain module (Appointments, Availability, Services); apply guardrails (Section 5) before executing any destructive tool call; decide when to trigger human handoff.
**Dependencies:** Conversations, Messages, Appointments, Availability, Services, Employees, Customers (as tool targets), Settings (AI behavior configuration per tenant).
**Public APIs:** `AiOrchestrationService` — handleInboundMessage(conversationId, messageContent), a set of internally-registered **tool handlers** (not externally exposed) that map to OpenAI tool-calling definitions: `checkAvailability`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`, `recommendService`, `answerFaq`, `escalateToHuman`.

---

#### **WhatsApp**
**Purpose:** Own all integration with the WhatsApp Business Cloud API — the transport layer, kept deliberately separate from AI (the reasoning layer) and Messages (the persistence layer).
**Responsibilities:** Webhook receipt and verification, inbound message normalization, outbound message sending (including template messages for reminders), delivery status webhook handling, per-tenant WhatsApp number/account configuration, media download/upload coordination with Files.
**Dependencies:** Conversations/Messages (to persist normalized messages), AI (to hand off inbound content for processing), Tenants (to resolve which tenant owns a given phone number), Files (media).
**Public APIs:** `WhatsAppWebhookController` (inbound HTTP boundary — verification + receipt), `WhatsAppSenderService` — sendTextMessage, sendTemplateMessage, sendMediaMessage; `WhatsAppAccountService` — connectAccount, disconnectAccount, getConnectionStatus.

---

#### **Billing**
**Purpose:** Own subscription and payment state via Stripe.
**Responsibilities:** Plan management, checkout/subscription creation, Stripe webhook handling (payment succeeded/failed, subscription updated/cancelled), usage-limit enforcement support (exposing current plan limits to other modules), dunning-state tracking, invoice history retrieval.
**Dependencies:** Tenants (subscription belongs to a tenant), Notifications (payment failure alerts).
**Public APIs:** `BillingService` — createCheckoutSession, getSubscriptionStatus, changePlan, cancelSubscription, getInvoiceHistory; `StripeWebhookController` (inbound HTTP boundary).

---

#### **Notifications**
**Purpose:** Single abstraction for all outbound notifications that are *not* WhatsApp customer messaging — i.e., email (and future channels like SMS/push) to platform users.
**Responsibilities:** Transactional email sending (verification, password reset, invites, payment failure alerts, weekly summaries), template management, delivery abstraction over the chosen email provider.
**Dependencies:** None domain-specific (consumed by many modules); depends only on Core and an external email provider adapter.
**Public APIs:** `NotificationsService` — sendEmail(templateId, recipient, data), sendAppointmentReminder (queued job trigger), sendPaymentFailedAlert.

---

#### **Dashboard**
**Purpose:** Aggregate read-optimized views for the salon web dashboard that don't belong to a single domain module (e.g., calendar summary, today's bookings, handoff queue, KPIs).
**Responsibilities:** Compose data from Appointments, Conversations, Billing for dashboard widgets; avoid embedding this aggregation logic inside single-purpose domain modules.
**Dependencies:** Appointments, Conversations, Customers, Billing (read-only composition, no writes).
**Public APIs:** `DashboardService` — getOverviewStats, getUpcomingAppointments, getHandoffQueue, getUsageSummary.

---

#### **Settings**
**Purpose:** Own tenant-level configuration that doesn't belong to a specific domain entity — notably AI behavior configuration (greeting, tone, escalation rules, cancellation policy text) and general preferences.
**Responsibilities:** CRUD for tenant settings; provide a typed, validated configuration object consumed by AI and Appointments (e.g., cancellation notice window).
**Dependencies:** Tenants (scoping).
**Public APIs:** `SettingsService` — getSettings(tenantId), updateSettings, getAiBehaviorConfig.

---

#### **Audit Logs**
**Purpose:** Immutable record of significant actions, especially AI-driven booking actions, for traceability and dispute resolution (FR-28).
**Responsibilities:** Append-only log writes triggered by other modules (appointment created/changed by AI or staff, settings changed, billing plan changed); query interface for staff/admin review.
**Dependencies:** Tenants (scoping); consumed by Appointments, AI, Billing, Settings, Admin as a write target.
**Public APIs:** `AuditLogService` — recordEvent(actorType, actorId, action, entity, metadata), getAuditTrail(filters).

---

#### **Files**
**Purpose:** Abstraction over S3-compatible object storage.
**Responsibilities:** Generate pre-signed upload/download URLs, manage file metadata (owner tenant, type, size, content-type), coordinate media received from WhatsApp and branding assets uploaded via the dashboard.
**Dependencies:** Tenants (scoping/ownership).
**Public APIs:** `FilesService` — getUploadUrl, getDownloadUrl, recordFileMetadata, deleteFile.

---

#### **Admin**
**Purpose:** Super Admin-only capabilities, isolated from tenant-scoped modules to avoid accidental cross-tenant exposure through normal application code paths.
**Responsibilities:** Cross-tenant tenant listing/search, tenant suspension/reactivation (support actions), platform-wide usage/analytics views, impersonation-for-support (audited), billing exception handling.
**Dependencies:** Reads across Tenants, Billing, Audit Logs, Dashboard (aggregate); guarded by a distinct `SuperAdminGuard`, never reachable via tenant-scoped guards.
**Public APIs:** `AdminService` — listTenants, getTenantDetail, suspendTenant, reactivateTenant, getPlatformUsageStats; all endpoints additionally require Super Admin role (Section 7).

### 3.3 Module Dependency Graph (Summary)

```
Core ← (everything)

Auth → Users, Tenants, Notifications
Users → Tenants
Employees → Tenants, Services, Users
Customers → Tenants, Conversations, Appointments
Services → Tenants, Employees
Appointments → Tenants, Employees, Services, Customers, Availability, AuditLogs, Notifications
Availability → Employees, Appointments, Services
Conversations → Tenants, Customers, Messages, AI
Messages → Conversations, Files
AI → Conversations, Messages, Appointments, Availability, Services, Employees, Customers, Settings
WhatsApp → Conversations, Messages, AI, Tenants, Files
Billing → Tenants, Notifications
Notifications → (external provider only)
Dashboard → Appointments, Conversations, Customers, Billing
Settings → Tenants
AuditLogs → Tenants
Files → Tenants
Admin → Tenants, Billing, AuditLogs, Dashboard
```

No module below the line depends on `Admin`, keeping Super Admin capability strictly additive and never a dependency of tenant-scoped business logic.

---

## 4. Frontend Architecture

### 4.1 Guiding Principle

The Angular application follows a **feature-module, standalone-component** structure (Angular 20 default) organized around the same domain boundaries as the backend, with a strict separation between **Core** (singleton, app-wide services), **Shared** (reusable, stateless UI), **Layouts** (shell composition), and **Features** (routed, domain-specific screens).

### 4.2 Core

Singleton services instantiated once for the app's lifetime, providing cross-cutting concerns:
- **API layer**: a thin, typed HTTP client wrapper per backend module (e.g., `AppointmentsApiService`, `BillingApiService`) built on Angular's `HttpClient`, centralizing base URL, error normalization, and typed request/response models.
- **Auth state**: current user/tenant/role held in an Angular Signal-based store (`AuthStateService`), hydrated on app bootstrap from a refresh-token exchange.
- **Interceptors**: attach the access token to outgoing requests; handle 401 by attempting a silent refresh; handle 403 by redirecting to an "access denied" state; global error interceptor normalizing backend error shape into UI-friendly notifications.
- **Guards**: `AuthGuard` (must be authenticated), `RoleGuard` (must have required role), `TenantActiveGuard` (blocks access if tenant is suspended, redirecting to a billing-resolution screen).
- **Error handling**: a global `ErrorHandler` for uncaught exceptions, wired to a toast/notification service.

### 4.3 Shared

Presentation-only, reusable building blocks with no domain knowledge and no direct API calls:
- UI primitives (buttons, inputs, modals, tables, date/time pickers, calendar grid component, badges/status chips).
- Directives/pipes (e.g., phone-number formatting, timezone-aware date pipes).
- Built with TailwindCSS utility classes and a small set of shared design tokens; components are standalone and imported directly where needed (no monolithic `SharedModule` re-export barrel that grows unbounded).

### 4.4 Layouts

Shell components that compose navigation chrome around routed feature content:
- `AuthLayout` — centered card layout for login/register/reset screens.
- `DashboardLayout` — sidebar + topbar shell for the authenticated salon app (Owner/Manager/Staff).
- `AdminLayout` — distinct shell for the Super Admin console, visually and structurally separated so it's never confusable with the tenant-facing app.

### 4.5 Feature Modules (Routed, Lazy-Loaded)

Each mirrors a backend domain boundary and is lazy-loaded via the Angular router to keep initial bundle size small:

- `onboarding` — sign-up, salon profile setup wizard, WhatsApp connection flow.
- `dashboard` — overview/home screen (KPIs, today's bookings, handoff queue).
- `appointments` — calendar view, manual booking creation/edit.
- `employees` — staff management, working hours, service assignment.
- `services` — service catalog CRUD.
- `customers` — customer list/history.
- `conversations` — conversation monitoring, handoff takeover view.
- `billing` — plan selection, payment method, invoice history.
- `settings` — salon profile, AI behavior configuration, notification preferences.
- `admin` — Super Admin console (tenant list, platform usage, support actions) — only loaded/routable for Super Admin role.
- `auth` — login, register, password reset, email verification, Google OAuth callback handling.

### 4.6 Routing

- Top-level routes split by layout: `/auth/*` (AuthLayout), `/app/*` (DashboardLayout, guarded), `/admin/*` (AdminLayout, guarded by Super Admin role).
- Each feature module owns its own child routes, lazy-loaded via standalone route configs (`loadChildren`/`loadComponent`), not NgModules.
- Route guards compose: `AuthGuard` → `TenantActiveGuard` → `RoleGuard` applied at the appropriate route level (e.g., billing-resolution bypass must still be reachable even when `TenantActiveGuard` would otherwise block, to let a suspended tenant fix payment).

### 4.7 State Management

- **Angular Signals** as the primary state primitive — no external state library (NgRx, etc.) at this stage, consistent with the fixed stack and appropriate for the app's complexity.
- Each feature owns a **signal-based store service** (e.g., `AppointmentsStore`) scoped to that feature's lazy-loaded injector where state shouldn't persist across navigation, or provided in root for state that should (e.g., `AuthStateService`, `TenantSettingsStore`).
- Server data fetched via the API layer, written into signals; computed signals derive UI-ready view models; effects (via `effect()`) handle side-effects like re-fetching on tenant switch.
- This keeps state colocated with the feature that owns it, avoiding a global store that becomes a dumping ground.

### 4.8 API Layer

- One typed API service per backend module (mirroring Section 3), each responsible only for HTTP calls and request/response typing — no business logic, no state.
- A shared `ApiClient` core wrapper standardizes error handling, base URL, and auth header injection so individual API services stay thin.
- DTO types are hand-aligned with backend response shapes (or generated from a shared contract in a later phase — see Section 12 for a note on API-contract generation as a future improvement).

### 4.9 Authentication (Frontend Side)

- Access token held in memory (signal), refresh token handled via httpOnly cookie (see Section 7) — the SPA never persists the access token to `localStorage` to reduce XSS token-theft risk.
- On app bootstrap, a silent refresh attempt establishes session state before rendering protected routes.
- Google OAuth handled via redirect flow: Angular redirects to backend-initiated OAuth URL, backend completes the exchange, redirects back to the SPA with a session established.

### 4.10 Guards

- `AuthGuard` — route-level, verifies an active session exists (via `AuthStateService`).
- `RoleGuard` — route-level, verifies the current user's role satisfies the route's declared requirement (data-driven via route `data: { roles: [...] }`).
- `TenantActiveGuard` — blocks feature access when the tenant's subscription is suspended, redirecting to billing resolution.
- `UnsavedChangesGuard` — generic `CanDeactivate` guard for forms with unsaved state (UX safeguard, not security-related).

### 4.11 Interceptors

- `AuthInterceptor` — attaches bearer token, triggers silent refresh on 401.
- `TenantContextInterceptor` — attaches any required tenant-context headers if applicable to the chosen auth model (see Section 8).
- `ErrorInterceptor` — normalizes backend error responses into a consistent shape for the notification/toast system.
- `LoadingInterceptor` — drives a global/section-level loading indicator via a shared signal.

### 4.12 Reusable UI Components

Calendar/scheduler grid, appointment card, conversation thread viewer, status badges (booking status, conversation status, subscription status), data table with sorting/pagination, form controls wrapping Tailwind styling with consistent validation-error display, confirmation modal (used for destructive actions — cancel appointment, remove staff, cancel subscription), toast/notification stack.

### 4.13 Folder Structure (Angular)

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── api/                 # per-module typed API services + ApiClient
│   │   │   ├── auth/                # AuthStateService, token handling
│   │   │   ├── guards/
│   │   │   ├── interceptors/
│   │   │   └── error/
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   ├── directives/
│   │   │   ├── pipes/
│   │   │   └── models/              # shared, cross-feature TS types/DTOs
│   │   ├── layouts/
│   │   │   ├── auth-layout/
│   │   │   ├── dashboard-layout/
│   │   │   └── admin-layout/
│   │   ├── features/
│   │   │   ├── onboarding/
│   │   │   ├── dashboard/
│   │   │   ├── appointments/
│   │   │   ├── employees/
│   │   │   ├── services/
│   │   │   ├── customers/
│   │   │   ├── conversations/
│   │   │   ├── billing/
│   │   │   ├── settings/
│   │   │   ├── admin/
│   │   │   └── auth/
│   │   ├── app.routes.ts
│   │   └── app.config.ts
│   ├── assets/
│   ├── environments/
│   └── styles/                      # Tailwind entry, design tokens
├── angular.json
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## 5. AI Architecture

### 5.1 Prompt Management

- Prompts are treated as **versioned configuration artifacts**, not inline strings scattered through code. A dedicated prompt-template store (files under source control, e.g., `backend/src/modules/ai/prompts/`) holds the base system prompt, per-intent instruction fragments, and tool-result formatting templates.
- Tenant-specific customization (greeting, tone, escalation rules from Settings) is **injected as structured variables** into the base template at runtime — tenants never edit raw prompts directly, preventing prompt-injection-through-configuration and keeping behavior predictable across tenants.

### 5.2 Conversation Memory

- Short-term memory: the AI module assembles a bounded, recent window of the conversation's message history (from the `Messages` module) on every call — not the entire history, to control token cost and stay within context limits.
- Long-term memory: durable facts (customer name, preferred staff, appointment history) are pulled from structured data (`Customers`, `Appointments`) rather than relying on the LLM to "remember" — the database, not the model, is the source of truth.
- No conversation state is retained inside OpenAI between calls; every call is stateless from OpenAI's perspective and fully reconstructed from PostgreSQL/Redis by the backend.

### 5.3 Tool Calling

- The AI is granted a fixed, explicit set of tools mirroring FR-8 through FR-13: `checkAvailability`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`, `recommendService`, `answerFaq`, `escalateToHuman`.
- Each tool has a strict input schema (validated server-side, not trusted from the model output) and executes real domain logic via the `Appointments`/`Availability`/`Services` module services described in Section 3 — the model **decides**, the backend **executes**.
- Tool execution results are fed back to the model to produce the final natural-language reply, keeping the conversational tone consistent even though the underlying action was deterministic code.

### 5.4 Structured Outputs

- Every model response the backend needs to act on programmatically (tool-call arguments, intent classification, escalation decisions) uses OpenAI **Structured Outputs** with a defined JSON schema — never free-text parsing — eliminating a whole class of parsing failures/hallucinated formats.
- Only the final customer-facing reply is free-text natural language; everything that drives business logic is schema-validated.

### 5.5 AI Context

Per-message context assembled by the `AI` module includes: tenant profile (hours, location, policies from `Settings`/`Tenants`), active service catalog (`Services`), employee availability window (`Employees`/`Availability`, fetched on-demand via tool calls rather than pre-stuffed), recent conversation history (`Messages`), and the requesting customer's known profile (`Customers`). Context is always scoped to exactly one tenant — the context-assembly step is itself tenant-guarded (Section 8).

### 5.6 Prompt Versioning

- Prompt templates carry a version identifier; the version used for a given AI-generated action is recorded on the `Messages`/`Audit Logs` entry.
- This enables safe iteration (A/B or staged rollout of a new prompt version) and post-hoc debugging ("this bad booking happened under prompt v3") without ambiguity.

### 5.7 Token Optimization

- Bounded history window (5.2), on-demand tool-based data fetching instead of pre-loading entire catalogs into every prompt, and reusing a compact system prompt (with tenant variables interpolated, not duplicated per call) all reduce token usage.
- Caching: relatively static per-tenant context (service catalog, salon profile) is cached in Redis and only invalidated on configuration change, avoiding redundant DB round-trips (not redundant token usage directly, but reduces latency contributing to overall response time).
- Monitoring token usage per tenant (Section 1.3, Billing/Admin) directly supports FR-22/FR-27 (plan-based usage limits and cost visibility).

### 5.8 Human Handoff

- The `escalateToHuman` tool is always available to the model and is explicitly instructed to be used for: explicit customer request for a human, complaints, ambiguous requests outside the defined tool set, or repeated failed understanding of customer intent.
- On escalation, `Conversations` status moves to "escalated," the AI stops auto-responding on that thread (per the business rule requiring no silent AI action after handoff), and `Notifications` alerts salon staff. The exact staff reply mechanism (own WhatsApp app vs. in-dashboard) is an open item from PROJECT_REQUIREMENTS.md Section 22 (Q4) and should be resolved before detailed design of this flow.

### 5.9 Hallucination Prevention

- **Grounding, not memorization**: the model is never asked to recall prices, durations, or availability from "knowledge" — those are always supplied fresh via tool results from the database on each relevant turn.
- **Structured Outputs** constrain the model to valid, schema-conformant actions — it cannot invent a tool or a malformed argument that would silently corrupt data.
- **Server-side validation** of every tool-call argument against real data (e.g., does this `serviceId` exist for this tenant, is this `employeeId` actually eligible) before executing — the model's output is treated as untrusted input, not a trusted command.
- **Confirmation step** (business rule from PROJECT_REQUIREMENTS.md Section 15) before finalizing any destructive/booking action, giving the customer a final chance to catch an AI misunderstanding.

### 5.10 Fallback Strategy

- If OpenAI is unavailable or times out: the AI module falls back to a pre-defined, tenant-configurable "we're experiencing an issue, a team member will follow up shortly" message, and the conversation is auto-flagged for human handoff rather than left silent — availability of *some* response is prioritized over blocking on the AI.
- If a tool execution fails (e.g., a race-condition double-booking attempt caught by `Availability`), the AI is given the failure as a structured tool result and instructed to gracefully offer alternatives, not surface a raw error to the customer.
- Repeated low-confidence turns (the model itself signals uncertainty, or the same clarifying question loops) trigger automatic escalation rather than degrading the customer experience indefinitely.

---

## 6. WhatsApp Architecture

### 6.1 Webhook Flow

Meta delivers all inbound events (messages, delivery/read receipts, account status changes) to a single backend webhook endpoint owned by the `WhatsApp` module. The controller's only synchronous responsibilities are: verify the request signature, resolve the tenant from the destination phone number ID, persist the raw event minimally, and enqueue it for asynchronous processing — then return a fast `200 OK` to Meta, since webhook providers expect prompt acknowledgment and will retry on timeout/non-2xx.

### 6.2 Incoming Messages

1. Webhook received → signature verified (6.9) → tenant resolved by phone number ID.
2. Raw payload enqueued in Redis (job queue) with an idempotency key derived from Meta's message ID.
3. A worker process picks up the job: normalizes the message (text, media, interactive reply types), persists it via `Messages`, updates/creates the `Conversation`.
4. Worker hands off to the `AI` module for processing (5.1–5.10), unless the conversation is currently in an escalated/human-handled state, in which case it's simply stored and surfaced to staff without triggering AI auto-response.

### 6.3 Outgoing Messages

- All outbound sends (AI replies, staff replies, reminders, booking confirmations) go through a single `WhatsAppSenderService`, funneled through an outbound queue rather than sent synchronously inline — this decouples message delivery from the request/processing path and enables retry without blocking the AI/booking flow.
- Reminder messages, being proactive (outside the customer-initiated 24-hour session window), must use Meta-approved **template messages** — a compliance constraint from PROJECT_REQUIREMENTS.md Section 20 that shapes this module's design (template registration/management is part of `WhatsApp` module responsibilities).

### 6.4 Message Queue

- Redis-backed job queue (e.g., BullMQ) with separate queues for **inbound processing** and **outbound sending**, allowing independent scaling/concurrency tuning and preventing a burst of inbound traffic from starving outbound reminder delivery or vice versa.
- Queue jobs carry `tenantId` explicitly so tenant scoping survives the transition from HTTP request context into background worker context (Section 8.3).

### 6.5 Retry Strategy

- Outbound sends: exponential backoff retry (e.g., a bounded number of attempts) on transient WhatsApp API failures (5xx, rate-limit responses); permanent failures (invalid number, customer opted out) are not retried and are surfaced to staff.
- Inbound processing: job failures (e.g., a transient OpenAI outage during AI processing) are retried with backoff; after exhausting retries, the conversation is flagged for human attention rather than silently dropped, consistent with the Fallback Strategy (5.10).

### 6.6 Idempotency

- Every inbound webhook event's Meta-provided message ID is used as an idempotency key (checked against Redis/DB before processing) to guard against Meta's at-least-once delivery guarantee causing duplicate processing (duplicate bookings, duplicate AI replies).
- Outbound sends triggered by internal jobs (e.g., a reminder job) carry their own idempotency key (e.g., `appointmentId + reminderType`) to prevent duplicate sends if a job is retried or re-queued.

### 6.7 Delivery Status

- Meta's delivery/read-receipt webhooks update the corresponding `Messages` record's status (sent/delivered/read/failed) asynchronously, giving staff visibility in the dashboard into whether a customer actually received a confirmation or reminder.
- Failed deliveries (e.g., customer blocked the business number) are surfaced as an actionable state, not silently swallowed.

### 6.8 Media Handling

- Inbound media (e.g., a customer sends a reference photo) is downloaded from Meta's media endpoint by a worker and re-uploaded to S3-compatible storage via the `Files` module, with the message record storing a reference to the stored file rather than Meta's transient media URL (which expires).
- Outbound media (if the salon sends images, e.g., a portfolio photo) is served from S3 via the `Files` module and uploaded through Meta's media API before referencing it in an outbound message.

### 6.9 Webhook Verification

- Initial webhook setup handshake (Meta's verification challenge/response) is handled once per tenant/app configuration.
- Every subsequent inbound webhook call is authenticated via signature verification (Meta's `X-Hub-Signature` header validated against the app secret) before any payload processing occurs — unverified requests are rejected immediately, preventing spoofed webhook calls from injecting fake messages or triggering fake bookings.

---

## 7. Authentication & Authorization

### 7.1 JWT

- Short-lived **access tokens** (JWT, signed, e.g., 15-minute expiry) carry `userId`, `tenantId`, and `role` claims, used to authorize API requests without a database round-trip on every call.
- Access tokens are held client-side in memory only (Section 4.9), not in `localStorage`, to limit exposure to XSS-based theft.

### 7.2 Refresh Tokens

- Long-lived **refresh tokens**, stored as httpOnly, secure, `SameSite=strict` cookies — inaccessible to client-side JavaScript, mitigating XSS token theft for the long-lived credential.
- Refresh tokens are rotated on every use (rotation-on-refresh) with prior-token invalidation tracked in Redis, so a stolen refresh token has a narrow reuse window and reuse-detection can trigger session revocation.
- Refresh token validity is tied to a session record allowing server-side revocation (logout-all-devices, admin-forced logout on suspicious activity).

### 7.3 RBAC (Role-Based Access Control)

Fixed platform roles, matching PROJECT_REQUIREMENTS.md Section 7:
- **Super Admin** (platform-wide, no tenant scope)
- **Salon Owner** (full tenant control)
- **Salon Manager** (near-owner, minus billing/account deletion)
- **Salon Staff** (scoped to own calendar/handoffs)

Roles are enforced via a `RolesGuard` reading the `role` claim from the validated JWT, combined with route-level `@Roles(...)` metadata decorators on controllers — authorization is always checked server-side; frontend `RoleGuard` (Section 4.10) is a UX convenience only, never a security boundary on its own.

### 7.4 Permission Model

- Beyond coarse roles, sensitive actions (e.g., `billing:manage`, `account:delete`, `staff:invite`) are expressed as **named permissions** mapped from role at the guard layer, so permission checks in code read declaratively (`@RequirePermission('billing:manage')`) rather than as scattered role-string comparisons — this keeps the model extensible if a future need arises for custom roles/permission sets per tenant, without requiring a redesign.
- Permission-to-role mapping is centralized in one place (within `Users`/`Core`) as the single source of truth.

### 7.5 Google OAuth

- Standard OAuth 2.0 authorization-code flow: Angular redirects to a backend-initiated Google auth URL; Google redirects back to a backend callback endpoint (`Auth` module) which exchanges the code, verifies the identity, links/creates the platform `User`, and issues the platform's own JWT/refresh-token pair — Google is used purely for identity verification, not as an ongoing session authority.
- Email from the verified Google identity must match/link to an existing invited user or trigger the standard sign-up path, consistent with tenant membership rules (a Google login cannot self-assign to an arbitrary tenant).

### 7.6 Password Reset

- Standard token-based flow: user requests reset → `Auth` generates a single-use, time-limited token (stored hashed, short TTL) → emailed via `Notifications` → user submits new password with the token → token validated and invalidated on use.
- All active sessions/refresh tokens for the user are invalidated on successful password reset as a security measure.

### 7.7 Email Verification

- Required before full account activation (at minimum before a Salon Owner can go live / connect WhatsApp — ties into the onboarding journey in PROJECT_REQUIREMENTS.md Section 14.1): a verification token is emailed on sign-up and invite; unverified accounts have restricted access until confirmed.

### 7.8 2FA-Ready Design

- Not required for MVP per requirements, but the `Auth` module's design reserves an explicit extension point: the login flow is structured as a two-step state machine (credential verification → session issuance) so a second factor (TOTP or email/SMS code) can be inserted between those steps later without restructuring the auth flow.
- The `User` data model reserves fields for a future second factor (e.g., TOTP secret, enabled flag) so this is additive, not a migration-heavy retrofit, when prioritized (schema specifics deferred to the database design phase).

---

## 8. Multi-Tenant Architecture

### 8.1 Tenant Isolation Strategy

- **Shared database, shared schema, tenant-scoped rows** (`tenant_id` discriminator column on every tenant-owned table) is the chosen approach — appropriate given the fixed PostgreSQL/Prisma stack, the self-managed VPS deployment (schema-per-tenant or database-per-tenant would multiply operational/migration overhead for little benefit at this scale), and the need to run cost-effectively across what may become many small-business tenants.
- This decision directly answers the open question in PROJECT_REQUIREMENTS.md Section 19 ("multi-tenancy strategy... must be decided") in favor of shared-schema with enforced row scoping, with a defined upgrade path to stronger isolation (8.6) if a future customer segment requires it.

### 8.2 tenant_id Strategy

- Every tenant-owned table carries a non-nullable `tenant_id` foreign key.
- **No module is permitted to query a tenant-owned table without an explicit `tenant_id` filter** — enforced structurally, not just by convention: repository/infrastructure-layer base classes (Section 2.1) require a tenant context to be passed into every query-building method, making a tenant-less query a compile-time/interface violation rather than something a developer could accidentally omit inline in a controller.
- Platform-level tables genuinely without tenant scope (e.g., global plan definitions) are the explicit exception and are documented as such.

### 8.3 Request Context

- On every authenticated HTTP request, a `TenantContextService` (Core module, Section 3.2) resolves and holds the current `tenantId` (from the JWT claim) for the lifetime of the request, injected into every downstream service call rather than threaded manually through function parameters.
- For **background jobs** (WhatsApp queue workers, reminder jobs, webhook processing), the equivalent context is carried explicitly as job payload data (since there's no HTTP request to derive it from) and re-established at the start of job processing — the same "no query without tenant context" rule applies identically in workers as in request handlers.
- For **Stripe/WhatsApp webhooks**, tenant is resolved from the webhook payload itself (Stripe customer/subscription metadata; WhatsApp destination phone number ID) before any downstream processing, and that resolution is treated as a trust boundary — invalid/unresolvable tenant mapping causes the event to be rejected/logged, not processed against a guessed tenant.

### 8.4 Authorization Layer Interaction with Tenancy

- Authorization (Section 7) and tenancy are layered checks: a request must first resolve to a valid tenant context, then RBAC/permission checks apply *within* that tenant. A Salon Owner role token for Tenant A carries no authority whatsoever over Tenant B's resources regardless of role — role is meaningless without the matching tenant scope, and both are validated on every request.
- Super Admin is the sole role that operates without a fixed tenant context, and its guard (`SuperAdminGuard`) is structurally distinct (Section 3.2 `Admin` module) rather than a "role that happens to bypass tenant checks" bolted onto the normal path — this avoids a shared code path where a bug could accidentally grant cross-tenant access to a non-admin role.

### 8.5 Data Leakage Prevention

- Defense in depth, not a single control: (1) application-layer enforced `tenant_id` filtering on every query (8.2), (2) integration tests specifically asserting cross-tenant access attempts are rejected, (3) structured logging that tags every data-access log line with the resolved `tenantId`, enabling anomaly auditing, (4) AI context assembly (Section 5.5) is itself tenant-scoped at the data-fetch layer, so there is no path by which one tenant's data could be pulled into another tenant's OpenAI call.
- Code review discipline: any new repository method touching a tenant-owned table is required to accept and apply a tenant identifier as a matter of the base repository contract (2.1/8.2), making the unsafe pattern harder to write than the safe one.

### 8.6 Future Row-Level Security (RLS) Compatibility

- The `tenant_id`-on-every-row design is intentionally **compatible with PostgreSQL Row-Level Security** as a future defense-in-depth layer: RLS policies could be added later (scoped to the session's `tenant_id`, set via `SET app.current_tenant_id`) to enforce isolation at the database layer itself, independent of application code correctness — without requiring any data model migration, only policy addition and a session-variable-setting step in the Prisma connection lifecycle.
- This is deliberately **not** enabled at initial launch (added operational complexity in connection/session management for a single-Postgres-instance modular monolith where application-layer enforcement is already rigorous) but is flagged as a natural hardening step once the platform reaches a scale or compliance requirement (e.g., an enterprise customer's security review) that justifies it.

---

## 9. Security Architecture

### 9.1 OWASP Top 10 Protections (Summary Mapping)

| OWASP Risk | Mitigation in This Architecture |
|---|---|
| Broken Access Control | RBAC + tenant-scoping enforced server-side on every request (Sections 7–8); no client-trusted authorization decisions. |
| Cryptographic Failures | TLS everywhere (9.4), secrets never in source control (9.5), passwords hashed with a strong adaptive algorithm (e.g., bcrypt/argon2), sensitive tokens hashed at rest. |
| Injection | Prisma parameterized queries exclusively — no raw string-concatenated SQL (9.8); all inputs validated via DTO schemas (9.3). |
| Insecure Design | Guardrails on AI destructive actions (Section 5.9), confirmation steps, tenant isolation as a first-class design constraint from day one, not bolted on. |
| Security Misconfiguration | Environment-specific config via env vars (10.6), security headers enforced globally (9.7), no default credentials in any deployed environment. |
| Vulnerable/Outdated Components | Dependency updates tracked via CI (Dependabot or equivalent), lockfiles committed, periodic audit as part of the CI/CD pipeline (10.5). |
| Identification & Auth Failures | Refresh-token rotation, short-lived access tokens, rate-limited login attempts (9.2), 2FA-ready design (7.8). |
| Software & Data Integrity Failures | CI/CD pipeline builds from source-controlled code only, container images built reproducibly, Stripe/WhatsApp webhook signature verification (6.9, Billing equivalent) before trusting any inbound event. |
| Security Logging & Monitoring Failures | Audit Logs module (3.2) plus centralized application logging/monitoring (10.9–10.10). |
| Server-Side Request Forgery | Outbound requests limited to a known, fixed set of external hosts (OpenAI, Meta, Stripe, S3, email provider) — no user-controlled URL fetching pattern exists in the design. |

### 9.2 Rate Limiting

- Global API rate limiting (per-IP and per-authenticated-user) at the Nginx layer and/or NestJS guard layer (e.g., via Redis-backed counters), with stricter limits on sensitive endpoints (login, password reset, OAuth callback) to blunt credential-stuffing/brute-force attempts.
- WhatsApp webhook and Stripe webhook endpoints are exempted from user-facing rate limits but protected instead by signature verification (6.9) and their own idempotency handling (6.6).
- Per-tenant AI/message-processing rate limits are additionally enforced in support of plan-based usage limits (FR-22), distinct from security-motivated rate limiting.

### 9.3 Validation

- All inbound HTTP payloads validated via DTO classes with decorator-based validation (NestJS `ValidationPipe`, applied globally) rejecting unrecognized/malformed fields before they reach any service logic (whitelist validation, not blacklist).
- AI tool-call arguments are independently re-validated server-side against real domain data before execution (Section 5.9) — validation is not a frontend-only or single-layer concern.

### 9.4 Encryption

- **In transit**: TLS enforced at the Nginx layer for all external traffic (HTTPS-only, HTTP redirected); internal Docker-network traffic between Nginx/backend/Postgres/Redis is within a private Docker network not exposed externally.
- **At rest**: database-level encryption at rest (via disk/volume encryption on the Hetzner VPS), S3-compatible storage encryption at rest (provider-dependent, enabled), and sensitive fields (e.g., WhatsApp/Stripe access tokens stored per tenant) additionally encrypted at the application layer before persistence, not just relying on disk encryption alone.

### 9.5 Secrets Management

- No secrets in source control at any point — enforced via `.gitignore` discipline and CI secret-scanning.
- Runtime secrets (OpenAI key, WhatsApp tokens, Stripe keys, DB credentials, JWT signing key, S3 credentials, email provider key) supplied via environment variables injected at deploy time (Docker Compose env files managed outside the repo, or a secrets manager if later adopted), distinct per environment (dev/staging/production).
- Per-tenant WhatsApp/Stripe credentials (where applicable) are stored encrypted in the database (9.4), never logged in plaintext.

### 9.6 Audit Logging

- Covered functionally in Section 3.2 (`Audit Logs` module); from a security standpoint, audit entries are treated as tamper-evident (append-only access pattern — no update/delete API surface exposed for audit records) and are themselves tenant-scoped except for Super Admin cross-tenant review access.

### 9.7 Security Headers

- Enforced globally (via Nginx and/or NestJS middleware, e.g., Helmet): `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors`), `Content-Security-Policy` scoped to known script/style/connect sources, `Referrer-Policy`.

### 9.8 SQL Injection Prevention

- Prisma's parameterized query builder is used exclusively for all data access — no raw SQL string interpolation anywhere in application code; any unavoidable raw-query need (rare, e.g., a complex reporting query) must use Prisma's parameterized `$queryRaw` with tagged-template parameter binding, never string concatenation, and is subject to explicit code-review sign-off.

### 9.9 XSS Prevention

- Angular's default output-encoding/sanitization is relied upon (no unchecked use of `innerHTML`/`bypassSecurityTrust*` APIs without explicit justification and review); CSP headers (9.7) act as a second layer of defense; access tokens are never stored in `localStorage` (7.1), reducing the impact of any XSS that does occur.

### 9.10 CSRF Strategy

- Because the access token is a bearer JWT sent via an `Authorization` header (not an ambient cookie the browser attaches automatically), the primary API surface is inherently not CSRF-vulnerable in the classic sense.
- The one ambient-cookie credential is the httpOnly refresh-token cookie (7.2) — its endpoint is protected via `SameSite=strict` cookie policy (blocking cross-site submission) plus a CSRF token double-submit pattern on the refresh endpoint specifically, as defense in depth for that narrow surface.

---

## 10. Infrastructure Architecture

### 10.1 Docker

- Every runtime component (NestJS backend, Angular build artifact served by Nginx, PostgreSQL, Redis) runs as a Docker container, ensuring environment parity between local development, staging, and production.
- Backend image built via a multi-stage Dockerfile (build stage with full toolchain → slim runtime stage) to minimize production image size and attack surface.

### 10.2 Docker Compose

- A single `docker-compose.yml` (with environment-specific override files, e.g., `docker-compose.prod.yml`) defines the full stack: `nginx`, `backend`, `postgres`, `redis`, and any worker process(es) for queue consumption — appropriate for the fixed single-VPS deployment target rather than a Kubernetes-based orchestration.
- Named volumes for PostgreSQL data and Redis persistence (if enabled) ensure data survives container recreation; the Docker network isolates internal service-to-service traffic from the public internet, with only Nginx exposed.

### 10.3 Nginx

- Serves the built Angular static assets directly and reverse-proxies API traffic (`/api/*`) to the NestJS backend container.
- Terminates TLS, applies security headers (9.7) and base rate limiting (9.2), and can serve as the WhatsApp/Stripe webhook ingress point (forwarding to backend) with appropriate timeout tuning given webhook providers' expectation of fast acknowledgment (6.1).

### 10.4 Reverse Proxy & HTTPS

- All public traffic terminates TLS at Nginx (certificates via Let's Encrypt/Certbot, auto-renewed); backend and datastore containers are never directly internet-exposed — only reachable via the internal Docker network from Nginx/backend respectively.
- HTTP requests are redirected to HTTPS unconditionally; no mixed-content paths.

### 10.5 CI/CD (GitHub Actions)

- Pipeline stages on every push/PR: install → lint → type-check → unit tests → build (backend + frontend) → (on `main`/release branch) build and push Docker images → deploy.
- Deployment to the Hetzner VPS via a controlled step (e.g., SSH-based `docker compose pull && docker compose up -d` against a deploy user with scoped access, or a self-hosted runner on the VPS) — deployment credentials stored as GitHub encrypted secrets, never in the repo.
- Database migrations (Prisma) run as an explicit, ordered pipeline step before the new backend version receives traffic, with a defined rollback procedure if a migration fails.
- Dependency vulnerability scanning integrated into the pipeline (e.g., Dependabot alerts / `npm audit` gate) per the OWASP "vulnerable components" mitigation (9.1).

### 10.6 Environment Variables

- Strict separation of environment configuration per deploy target (local/staging/production), managed via `.env` files excluded from source control and injected at container runtime; a checked-in `.env.example` documents required variables without values.
- Configuration validated at backend bootstrap (fail-fast if a required variable is missing/malformed) rather than failing later at first use.

### 10.7 Backups

- Automated, scheduled PostgreSQL backups (e.g., nightly full dump plus WAL-based point-in-time recovery if the operational maturity warrants it) stored off the primary VPS — pushed to the S3-compatible storage bucket (a distinct bucket/prefix from application file storage) to survive total VPS loss.
- Backup restoration is periodically tested (not just taken on faith) — an explicit operational runbook item, not purely an architectural one, but the architecture must make restoration straightforward (versioned, timestamped backup files with documented restore steps).
- Defined retention policy balancing recovery needs against storage cost and the data-retention/deletion compliance requirement noted in PROJECT_REQUIREMENTS.md Section 20.

### 10.8 Monitoring

- Application health and error-rate monitoring (e.g., an APM/error-tracking tool such as Sentry-class tooling for exception capture, plus infrastructure-level monitoring of CPU/memory/disk on the VPS) to catch degradation before it becomes an outage — directly supporting the Critical availability NFR.
- Per-tenant AI/WhatsApp usage monitoring (Section 5.7, FR-27) feeds both cost-control and platform-health visibility for Super Admins.

### 10.9 Logging

- Structured (JSON) application logs, every line tagged with correlation ID, `tenantId` (where applicable), and request/job context (Section 8.3), shipped to a centralized log store/aggregator rather than left only in container stdout — necessary given a multi-tenant system where support/debugging must be traceable per tenant without grepping raw container logs on the VPS.

### 10.10 Health Checks

- Each container exposes a lightweight health-check endpoint (`/health` on the backend, standard checks for Postgres/Redis) consumed by Docker Compose's `healthcheck` directive, enabling automatic restart of an unhealthy container and providing a clear signal for deployment scripts to confirm a new version is actually serving before considering a deploy successful.
- A deeper `/health/ready` check (backend can reach Postgres, Redis, and has valid config) is distinguished from a shallow liveness check, supporting correct restart-vs-wait behavior during deploys.

### 10.11 Deployment Strategy

- Given a single-VPS Docker Compose target (not a multi-node orchestrator), deployment uses a **rolling restart with health-check gating**: new images are pulled and started, health checks must pass before old containers are torn down, minimizing downtime without requiring blue/green infrastructure this stack doesn't have.
- Database migrations are designed to be **backward-compatible within a deploy window** (additive changes deployed ahead of code that depends on them; destructive changes follow a documented multi-step migration pattern) to avoid a hard coupling between "migration applied" and "new code deployed" instants.
- Rollback plan: prior Docker image tags are retained (not immediately pruned) so a failed deploy can be rolled back by redeploying the last known-good tag; database migration rollback procedures are defined per-migration where the change isn't purely additive.

---

## 11. Scalability Strategy

### 11.1 Horizontal Scaling

- The backend container is designed to be **stateless** (no in-process session/state that isn't in Postgres/Redis), so it can run as multiple replicas behind Nginx load-balancing on the same VPS (or across a small fleet of VPS instances) purely by increasing container count — no code changes required to scale the API tier horizontally within the Docker Compose model.
- Statelessness is the specific design property that makes 11.7 (future Kubernetes migration) viable without a rewrite.

### 11.2 Caching

- Redis caches read-heavy, low-volatility data: tenant configuration/settings, service catalogs, and computed availability windows within a short TTL — reducing PostgreSQL load on the hottest paths (every inbound WhatsApp message touches tenant config).
- Cache invalidation follows a simple, explicit pattern: writes to the source-of-truth table (via the owning module's service) actively invalidate the corresponding cache key rather than relying purely on TTL expiry, keeping AI-facing data (Section 5.7) fresh enough to avoid stale-availability booking errors.

### 11.3 Redis (Broader Role)

Beyond caching (11.2): job queue broker (Section 6.4), rate-limiting counters (9.2), idempotency key storage (6.6), and refresh-token rotation tracking (7.2) — a single Redis instance serving multiple concerns, appropriate at current scale, with logical separation via key namespacing/prefixing per concern so they remain independently reasoned-about despite sharing infrastructure.

### 11.4 Database Indexing

- Every `tenant_id` column is indexed (typically as a leading column in composite indexes) since virtually every query is tenant-scoped — this is the single highest-leverage indexing decision given the access pattern (Section 8.2).
- Additional indexes on high-frequency lookup/filter columns: phone number (customer lookup on inbound WhatsApp message), appointment date-range + employee (availability/conflict queries), conversation status (handoff queue queries) — exact index definitions deferred to the database design phase, but the *strategy* (index every tenant-scoped, high-cardinality filter/join path) is set here.

### 11.5 Background Jobs

- All non-immediate-response work (outbound WhatsApp sending, reminder scheduling, email sending, webhook post-processing, report/export generation) runs as background jobs rather than inline in the HTTP request/response cycle — keeping API response times low and decoupling the system from third-party API latency (OpenAI, Meta, Stripe, email provider) on the critical request path.
- Reminder jobs (FR-15) are scheduled (e.g., a recurring scan job enqueuing due reminders, or per-appointment delayed jobs at creation time) — specific scheduling mechanism is an implementation detail of the `Notifications`/`Appointments` modules, but the architectural commitment is that reminders are queue-driven, not a synchronous cron script coupled to the API process.

### 11.6 Queue System

- A Redis-backed job queue library (e.g., BullMQ) provides the queue implementation referenced throughout Sections 6 and 11.5, with separate named queues per concern (inbound WhatsApp processing, outbound WhatsApp sending, email, reminders, webhook post-processing) so concurrency/priority/retry policy can be tuned independently per queue rather than sharing one undifferentiated job pool.
- Worker processes consuming these queues can run within the same backend container (in-process workers) at current scale, or be split into a dedicated worker container/replica if a specific queue becomes a bottleneck — the modular monolith's boundaries (Section 2) make this split straightforward without touching business logic.

### 11.7 Connection Pooling

- Prisma's connection pool to PostgreSQL is sized relative to expected concurrent backend replica count and Postgres's own `max_connections`, with a pooler (e.g., PgBouncer) as a documented future addition once replica count or connection churn (many short-lived worker connections) makes direct pooling insufficient — flagged here as a scaling lever, not implemented at initial launch scale.

### 11.8 Future Kubernetes Migration

- Not part of the fixed initial stack, but the architecture is deliberately **not precluded** from a future migration: stateless backend containers (11.1), externalized state (Postgres/Redis, not in-process), and health-check endpoints (10.10) are exactly the properties Kubernetes deployments require.
- The migration trigger would be operational, not purely traffic-driven: needing multi-node scheduling, zero-downtime rolling deploys at a scale Docker Compose can't comfortably express, or geographic redundancy — none of which are current requirements per PROJECT_REQUIREMENTS.md, so this remains a documented option, not near-term work.

---

## 12. Design Decisions

| # | Decision | Why Chosen | Advantages | Tradeoffs | Future Improvement Path |
|---|---|---|---|---|---|
| D1 | Modular Monolith over Microservices | Small team, single-VPS infra constraint, strong transactional needs (booking conflict prevention) | Simple ops, ACID transactions across booking logic, low latency, single CI/CD pipeline | Whole app scales/deploys as one unit; a noisy-neighbor module (e.g., AI processing under load) affects the same process as booking APIs | Extract a specific module (e.g., WhatsApp/AI processing) into its own service once its scaling profile genuinely diverges (Section 11.8) |
| D2 | Clean Architecture layering within modules | Keeps business rules testable/independent of framework and DB specifics | Domain logic reusable/testable without Nest/Prisma; easier long-term maintenance | More upfront structure/boilerplate per module than a flat MVC style | N/A — this is the durable structural choice, not expected to change |
| D3 | Shared-schema, `tenant_id`-scoped multi-tenancy | Fits fixed Postgres/Prisma stack, cost-effective for many small-business tenants | Simple migrations (one schema), efficient resource use across many low-volume tenants | Isolation depends on disciplined application-layer enforcement, not database-enforced by default | Add PostgreSQL Row-Level Security as a defense-in-depth layer (Section 8.6) if compliance/enterprise needs arise |
| D4 | Angular Signals over NgRx/external state library | Matches app complexity; avoids boilerplate of a full state-management library for a moderately-sized dashboard | Simpler mental model, less dependency surface, aligns with modern Angular direction | Less mature ecosystem/tooling than NgRx for very complex cross-cutting state | Adopt a dedicated state library only if cross-feature state complexity genuinely outgrows signal-store patterns |
| D5 | OpenAI Tool Calling + Structured Outputs as the sole AI execution model (no free-text business-logic parsing) | Eliminates hallucinated/malformed actions from reaching real business logic (Section 5.9) | Strong correctness guarantees for booking-affecting AI output | Requires disciplined schema maintenance as tools evolve; slightly more integration work than naive prompting | Expand tool set carefully with the same schema-first discipline as new AI capabilities (Section 11 of requirements doc) are added |
| D6 | Redis as shared cache + queue + rate-limit + idempotency store | Avoids introducing multiple pieces of infrastructure for related-but-distinct ephemeral-state needs, fitting the fixed stack and single-VPS budget | Operationally simple (one more service to run, not four) | Concerns share infrastructure capacity; a misbehaving queue could theoretically pressure cache memory | Key-namespacing (11.3) contains this now; split into dedicated Redis instances/managed services only if contention is observed |
| D7 | Backend as sole owner of all third-party credentials (OpenAI, WhatsApp, Stripe, S3, email) | Frontend and customers never need or should hold these secrets | Minimizes secret exposure surface, centralizes rate-limit/cost control | Backend is a single point of integration failure for all external dependencies | Circuit-breaker/fallback patterns per integration (already partially addressed in Section 5.10 for OpenAI) |
| D8 | Bearer JWT (header-based) access token + httpOnly-cookie refresh token | Removes classic CSRF exposure from the main API surface while still protecting the long-lived credential from XSS | Strong combined XSS/CSRF posture without extra libraries | Slightly more complex refresh-flow implementation than a single-cookie session model | 2FA insertion point already reserved (7.8) if stronger auth assurance is needed later |
| D9 | Docker Compose on a single Hetzner VPS (not Kubernetes) at launch | Matches fixed infra decision and current scale needs; avoids premature orchestration complexity | Low operational overhead, cost-effective, fast to iterate on | Manual/limited multi-node scaling and failover compared to an orchestrator | Stateless design (11.1) keeps a future Kubernetes migration additive, not a rewrite (11.8) |
| D10 | Background-job-driven architecture for all third-party-dependent work (WhatsApp send, email, reminders) | Decouples API responsiveness from third-party latency/outages | Predictable API latency, resilient to transient third-party failures via retry (Section 6.5) | Adds eventual-consistency windows (e.g., a reminder isn't sent the exact instant it's due) and queue-monitoring operational responsibility | Queue-specific worker scaling/splitting (11.6) as load grows |

---

## 13. Risks

| # | Risk | Technical Impact | Mitigation |
|---|---|---|---|
| R1 | Cross-tenant data leakage due to a missed `tenant_id` filter in a new query | Critical — violates the platform's core trust guarantee (FR-3) | Structural enforcement via base repository contracts (8.2), mandatory integration tests asserting cross-tenant rejection, code review checklist item, future RLS as a database-level backstop (8.6) |
| R2 | AI executes an incorrect booking action due to a subtle prompt/tool-schema flaw | High — direct customer/business trust damage | Structured Outputs + server-side re-validation of every tool argument (5.4, 5.9), mandatory confirmation step before destructive actions, prompt versioning for traceability (5.6) |
| R3 | Single-VPS deployment becomes a capacity or availability bottleneck as tenant count grows | Medium-High — affects the Critical availability NFR | Stateless backend design enables horizontal replica scaling within Compose first (11.1); documented Kubernetes migration path (11.8) if that ceiling is reached |
| R4 | WhatsApp webhook delivery burst (e.g., a marketing spike for one tenant) starves processing for other tenants | Medium — noisy-neighbor effect within the shared monolith/queue | Per-tenant rate limiting (9.2), separate inbound/outbound queues (6.4) preventing cross-contamination, plan-based usage limits (FR-22) bounding any single tenant's volume |
| R5 | OpenAI or WhatsApp Cloud API outage/latency spike | High — core product function degrades | Fallback messaging strategy (5.10), retry with backoff (6.5), human-handoff auto-escalation on repeated failure, monitoring/alerting (10.8) to detect degradation quickly |
| R6 | Redis outage impacts cache, queue, rate-limiting, and idempotency simultaneously (shared infra, D6) | High — multiple subsystems degrade at once | Redis persistence configuration + backup awareness, health checks (10.10) triggering fast alerting, queue jobs designed to be safely retryable/idempotent (6.6) so a Redis restart doesn't corrupt state, monitoring dedicated to Redis health |
| R7 | Migration/deploy causes downtime or a partially-applied schema change | Medium — availability and data-integrity risk during releases | Backward-compatible migration discipline (10.11), health-check-gated rolling restarts, documented rollback procedure per migration |
| R8 | Secrets leakage (accidental commit, misconfigured env) | Critical — could expose OpenAI/WhatsApp/Stripe credentials for all tenants at once | CI secret scanning, strict `.gitignore`/`.env.example` discipline (10.6/9.5), least-privilege credential scoping where the provider supports it |
| R9 | Token-cost overrun relative to subscription revenue (OpenAI usage scaling faster than plan pricing anticipated) | Medium-High — margin risk (echoes PROJECT_REQUIREMENTS.md Section 17) | Token optimization strategy (5.7), per-tenant usage monitoring feeding plan enforcement (FR-22) and Admin visibility (FR-27) |
| R10 | Growing "modular monolith" discipline erodes over time (modules start reaching into each other's internals, architecture doc goes stale) | Medium — long-term maintainability risk, not immediate | Enforced module boundaries via lint rules/dependency-graph checks in CI (extends 10.5), code review discipline, this document maintained as a living reference alongside major changes |

---

## 14. Recommended Folder Structure

```
kapis-receptionist/
├── backend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── context/                 # tenant context, correlation id
│   │   │   ├── guards/                  # base guards (auth, roles, tenant-active, super-admin)
│   │   │   ├── interceptors/            # logging, transform, error
│   │   │   ├── filters/                 # global exception filters
│   │   │   └── decorators/              # @Roles, @RequirePermission, @CurrentTenant
│   │   ├── common/
│   │   │   ├── dto/                     # shared base DTOs
│   │   │   ├── utils/
│   │   │   └── constants/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── domain/
│   │   │   │   ├── application/
│   │   │   │   ├── infrastructure/
│   │   │   │   └── interface/
│   │   │   ├── users/
│   │   │   ├── tenants/
│   │   │   ├── employees/
│   │   │   ├── customers/
│   │   │   ├── services/
│   │   │   ├── appointments/
│   │   │   ├── availability/
│   │   │   ├── conversations/
│   │   │   ├── messages/
│   │   │   ├── ai/
│   │   │   │   ├── prompts/             # versioned prompt templates
│   │   │   │   ├── tools/               # tool definitions + handlers
│   │   │   │   └── ...
│   │   │   ├── whatsapp/
│   │   │   ├── billing/
│   │   │   ├── notifications/
│   │   │   ├── dashboard/
│   │   │   ├── settings/
│   │   │   ├── audit-logs/
│   │   │   ├── files/
│   │   │   └── admin/
│   │   ├── queues/                      # queue definitions, processors/workers
│   │   ├── config/                      # env validation/config module
│   │   ├── prisma/                      # Prisma service/client wrapper (schema itself under /prisma at repo root per convention)
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma                # (deferred — database design phase)
│   │   └── migrations/
│   ├── test/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── e2e/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   ├── shared/
│   │   │   ├── layouts/
│   │   │   ├── features/
│   │   │   ├── app.routes.ts
│   │   │   └── app.config.ts
│   │   ├── assets/
│   │   ├── environments/
│   │   └── styles/
│   ├── Dockerfile
│   ├── angular.json
│   ├── tailwind.config.js
│   └── package.json
│
├── infrastructure/
│   ├── docker/
│   │   ├── nginx/
│   │   │   ├── nginx.conf
│   │   │   └── conf.d/
│   │   ├── postgres/
│   │   │   └── init/
│   │   └── redis/
│   ├── docker-compose.yml
│   ├── docker-compose.staging.yml
│   ├── docker-compose.prod.yml
│   └── env/
│       ├── .env.example
│       ├── .env.staging (gitignored)
│       └── .env.production (gitignored)
│
├── .github/
│   └── workflows/
│       ├── ci.yml                       # lint, test, build on PR/push
│       ├── deploy-staging.yml
│       └── deploy-production.yml
│
├── scripts/
│   ├── db/
│   │   ├── backup.sh
│   │   └── restore.sh
│   ├── deploy/
│   │   └── deploy.sh
│   └── setup/
│       └── local-bootstrap.sh
│
├── docs/
│   ├── PROJECT_REQUIREMENTS.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── adr/                             # Architecture Decision Records (future, per-decision detail beyond Section 12)
│   └── runbooks/                        # backup restore, incident response, deploy rollback
│
├── .gitignore
├── README.md
└── LICENSE
```

---

## Document Status & Next Steps

This document defines **architecture only** — no application code, no database schema, and no API contracts have been produced, per instruction.

**Key decisions made in this phase requiring your explicit sign-off before proceeding:**
1. Modular monolith with Clean Architecture layering (Section 2) — not microservices, at this stage.
2. Shared-schema, `tenant_id`-scoped multi-tenancy (Section 8) — not database-per-tenant.
3. Angular Signals for state management — no NgRx.
4. JWT access token (header) + httpOnly refresh-token cookie auth model (Section 7).
5. Redis as a unified cache/queue/rate-limit/idempotency store (Section 11.3).
6. Docker Compose on a single Hetzner VPS at launch, with a documented (not implemented) Kubernetes migration path.

**Open items carried forward from PROJECT_REQUIREMENTS.md Section 22** that should ideally be resolved before database design, since they affect schema shape: human handoff mechanism (Q4), WhatsApp number provisioning model (Q10), staff skill-matching granularity (Q12), and usage-limit definition (Q7).

**Recommended next step:** Proceed to **Database Design** — Prisma schema definition, entity-relationship modeling, index strategy detail, and migration planning — once this architecture is approved.

**Awaiting your approval before proceeding.**
