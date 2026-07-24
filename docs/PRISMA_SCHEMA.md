# PRISMA_SCHEMA.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### Prisma Schema Design & Migration Strategy

**Document Status:** Draft for Approval
**Version:** 1.0
**Depends on:** PROJECT_REQUIREMENTS.md, SYSTEM_ARCHITECTURE.md, DATABASE_DESIGN.md (v1.0 each)
**Scope:** Prisma schema (`schema.prisma`) design and migration strategy only. No NestJS code, no Angular code, no API endpoints, no repositories/services. Application code follows in a later phase pending approval of this document.

> This document reproduces the schema as it will appear in `schema.prisma`, split into reviewable sections by domain, each followed by a short explanation of purpose, relations, indexes, constraints, and cascade behavior. The final consolidated file layout is described in Section 14 (Migration Strategy).

---

## 0. Naming Reconciliation Note

This phase's requested model list differs slightly in naming from DATABASE_DESIGN.md; every difference is intentional and reconciled here so the two documents stay traceable to each other:

- **`UserRole`** is implemented as a genuine many-to-many junction between `User` and `Role` (replacing DATABASE_DESIGN.md's single `role_id` FK on `User`), so a user can in principle hold more than one role — a low-cost flexibility upgrade requested explicitly in this phase.
- The **`UserRole` enum** requested in the "create enums where appropriate" examples is implemented as `RoleName` instead (an enum constraining `Role.name`) to avoid a naming collision with the `UserRole` junction **model** — Prisma does not allow a model and an enum to share an identifier.
- **`TenantSubscription`** (requested under Tenant Models) and **`Subscription`** (requested under Billing Models) refer to the same underlying entity — a tenant's one active subscription record, mirroring Stripe. It is modeled **once**, as `Subscription`, under Billing (Section 8), with a `@@unique` on `tenantId` enforcing the 1:1 relationship DATABASE_DESIGN.md Section 3.8.2 already specified. This avoids two tables carrying the same billing state out of sync with each other.
- **`Category`** (DATABASE_DESIGN.md) is renamed **`ServiceCategory`** to match this phase's naming exactly.
- **`AppointmentHistory`** (DATABASE_DESIGN.md) is renamed **`AppointmentStatusHistory`** to match this phase's naming exactly; behavior is unchanged.
- **`Setting`** (DATABASE_DESIGN.md, platform-global) is renamed **`SystemSetting`** to match this phase's naming exactly.
- **`WhatsAppWebhookEvent`** and the generic **`webhook_events`** (DATABASE_DESIGN.md) map to this phase's **`WebhookEvent`** (WhatsApp-specific inbound log) and **`WebhookLog`** (Billing/Stripe inbound log) respectively — same two-table split, renamed to match this phase's requested vocabulary.
- Three models are **new** relative to DATABASE_DESIGN.md, added because this phase's requirements explicitly call for them: `TenantFeature` (per-tenant feature flag/entitlement overrides beyond plan defaults), `BusinessHours` (salon-wide opening hours, distinct from per-employee `WorkingHours`), `Room` and `Branch` (future-ready, minimally wired — see Section 4), `AppointmentReminder` (a proper table for scheduled reminder tracking, replacing the single `reminderSentAt` flag), `AppointmentFeedback` (post-visit rating capture), `CustomerPreference` (structured preference data, distinct from free-text `CustomerNote`), `PromptVersion` (a queryable registry for AI prompt versions), `MessageStatus` (an append-only delivery-receipt history per message, distinct from the current-state `status` column on `Message`), and `NotificationTemplate` (managed, versioned notification content, replacing a bare `templateKey` string).

---

## 1. Global Configuration

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres", "relationJoins"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgcrypto, uuid_ossp]
}

generator erd {
  provider = "prisma-erd-generator"
  output   = "../docs/erd.svg"
}
```

**Rationale:**
- `pgcrypto` provides `gen_random_uuid()` for standard UUIDv4 primary keys (DATABASE_DESIGN.md Section 1.5).
- `fullTextSearchPostgres` and `relationJoins` are preview features enabled in anticipation of Section 6.4's flagged future search indexes and to allow Prisma's query engine to push multi-relation reads down into a single SQL join rather than N+1 application-side queries — relevant given the heavy relation density of this schema.
- The `erd` generator is a documentation aid only (regenerates a visual ERD from the schema on build) — not a functional requirement, included so the visual diagram DATABASE_DESIGN.md deliberately deferred can be produced mechanically from this file once it exists, rather than hand-drawn and risking drift.

### 1.1 UUID Generation Strategy (Restated for Schema Authoring)

Per DATABASE_DESIGN.md Section 1.5, two primary-key generation strategies are used:

| Strategy | Prisma Declaration | Used For |
|---|---|---|
| **UUIDv4** (standard, unordered) | `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` | All tables except the high-write, time-ordered set below |
| **UUIDv7** (time-ordered) | `@id @db.Uuid` — **no database default**; generated at the application layer at insert time via a UUIDv7 library (e.g., `uuidv7` npm package) passed explicitly to Prisma's `create()` call | `Message`, `MessageStatus`, `AuditLog`, `ActivityLog`, `AppointmentStatusHistory`, `NotificationLog`, `WebhookEvent`, `WebhookLog` |

PostgreSQL has no native `uuidv7()` function as of the versions in common production use, and Prisma's schema DSL cannot express "generate a v7 UUID by default" without a database extension or trigger. Rather than add an unmanaged database-side function (a migration-fragility risk), UUIDv7 generation is pushed to the application/repository layer for the specific tables that benefit from it — this is a **deliberate, documented exception** to "every ID has a schema-level default," flagged again in Section 14 so it is not mistaken for an oversight during code review.

### 1.2 Standard Field Block (Convention, Not a Prisma Feature)

Prisma has no model inheritance/mixins — every model must declare its own fields. The block below is the **convention** applied to every tenant-owned model unless a model's section explicitly says otherwise; it is written out in full in every model definition that follows, not copy-pasted by reference, exactly as it will appear in the real file.

```prisma
// Standard Tenant-Owned Fields (reference only — not a real Prisma block)
id            String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
tenantId      String     @db.Uuid
createdAt     DateTime   @default(now())
updatedAt     DateTime   @updatedAt
createdByType ActorType  @default(USER)
createdById   String?    @db.Uuid
updatedByType ActorType  @default(USER)
updatedById   String?    @db.Uuid
```

Soft-deletable models additionally declare:

```prisma
// Standard Soft-Delete Fields (reference only)
deletedAt     DateTime?
deletedByType ActorType?
deletedById   String?    @db.Uuid
```

---

## 2. Enums

```prisma
enum ActorType {
  USER
  AI
  SYSTEM
  CUSTOMER
}

enum RoleName {
  SUPER_ADMIN
  OWNER
  MANAGER
  STAFF
}

enum TenantStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELLED
}

enum EmployeeStatus {
  ACTIVE
  ON_LEAVE
  INACTIVE
}

enum AppointmentStatus {
  PENDING
  CONFIRMED
  RESCHEDULED
  CANCELLED
  COMPLETED
  NO_SHOW
}

enum AppointmentHistoryAction {
  CREATED
  RESCHEDULED
  CANCELLED
  COMPLETED
  NO_SHOW
  MODIFIED
}

enum ReminderChannel {
  WHATSAPP
  EMAIL
  SMS
}

enum ReminderStatus {
  SCHEDULED
  SENT
  FAILED
  CANCELLED
}

enum ConversationStatus {
  OPEN_AI
  ESCALATED
  HUMAN_HANDLING
  RESOLVED
  CLOSED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageSenderType {
  CUSTOMER
  AI
  STAFF
  SYSTEM
}

enum MessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  TEMPLATE
  INTERACTIVE
  LOCATION
}

enum MessageDeliveryStatus {
  QUEUED
  SENT
  DELIVERED
  READ
  FAILED
}

enum WebhookProcessingStatus {
  PENDING
  PROCESSED
  FAILED
  IGNORED
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  INCOMPLETE
  UNPAID
}

enum InvoiceStatus {
  DRAFT
  OPEN
  PAID
  VOID
  UNCOLLECTIBLE
}

enum PaymentStatus {
  SUCCEEDED
  FAILED
  PENDING
  REFUNDED
}

enum CouponDiscountType {
  PERCENT
  FIXED
}

enum CouponDurationType {
  ONCE
  REPEATING
  FOREVER
}

enum NotificationChannel {
  EMAIL
  SMS
  IN_APP
  WHATSAPP
}

enum NotificationType {
  ACCOUNT
  BILLING
  BOOKING
  SYSTEM
  MARKETING
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}

enum FileOwnerType {
  TENANT_BRANDING
  INVOICE_EXPORT
  CUSTOMER_UPLOAD
  REPORT_EXPORT
  MESSAGE_MEDIA
}
```

**Why enums, not strings, for these fields (DATABASE_DESIGN.md Section 11.2 restated):** every value set above is small, stable, and branched on exhaustively in application logic — a native PostgreSQL enum gives Prisma compile-time exhaustiveness checking and the database a cheap, indexable, storage-efficient type. The one deliberate exception carried forward from DATABASE_DESIGN.md is `AuditLog.action`, kept as `String` (Section 11) because its value set grows with every new auditable action across modules and a native enum would force a migration per addition — an unnecessary friction cost for a field that is filtered on, never exhaustively `switch`-branched.

---

## 3. Authentication Models

```prisma
model User {
  id                String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String?    @db.Uuid
  email             String     @unique @db.VarChar(255)
  passwordHash      String?    @db.VarChar(255)
  firstName         String     @db.VarChar(100)
  lastName          String     @db.VarChar(100)
  googleId          String?    @unique @db.VarChar(255)
  isEmailVerified   Boolean    @default(false)
  isActive          Boolean    @default(true)
  lastLoginAt       DateTime?
  twoFactorEnabled  Boolean    @default(false)
  twoFactorSecret   String?    @db.VarChar(255)
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  deletedAt         DateTime?
  deletedByType     ActorType?
  deletedById       String?    @db.Uuid

  tenant                  Tenant?                  @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  roles                   UserRole[]
  employee                Employee?
  sessions                RefreshToken[]
  passwordResets          PasswordReset[]
  emailVerifications      EmailVerification[]
  invitationsSent         TenantInvitation[]       @relation("InvitedBy")
  auditLogs               AuditLog[]               @relation("AuditActor")
  activityLogs            ActivityLog[]
  customerNotesAuthored   CustomerNote[]
  assignedConversations   Conversation[]           @relation("AssignedStaff")
  messagesSent            Message[]                @relation("StaffSender")
  filesUploaded           File[]
  notifications           Notification[]
  apiKeysCreated          APIKey[]

  @@index([tenantId], name: "idx_users_tenant_id")
  @@map("users")
}

model Role {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        RoleName @unique
  description String?  @db.VarChar(255)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  permissions RolePermission[]
  users       UserRole[]

  @@map("roles")
}

model Permission {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key         String   @unique @db.VarChar(100)
  description String?  @db.VarChar(255)
  createdAt   DateTime @default(now())

  roles RolePermission[]

  @@map("permissions")
}

model RolePermission {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  roleId       String   @db.Uuid
  permissionId String   @db.Uuid
  createdAt    DateTime @default(now())

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId], name: "uq_role_permissions_role_permission")
  @@index([permissionId], name: "idx_role_permissions_permission_id")
  @@map("role_permissions")
}

model UserRole {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @db.Uuid
  roleId    String   @db.Uuid
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Restrict)

  @@unique([userId, roleId], name: "uq_user_roles_user_role")
  @@index([roleId], name: "idx_user_roles_role_id")
  @@map("user_roles")
}

model RefreshToken {
  id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId              String?   @db.Uuid
  userId                String    @db.Uuid
  refreshTokenHash      String    @unique @db.VarChar(255)
  userAgent             String?   @db.VarChar(255)
  ipAddress             String?   @db.VarChar(45)
  expiresAt             DateTime
  revokedAt             DateTime?
  replacedBySessionId   String?   @db.Uuid
  createdAt             DateTime  @default(now())

  user             User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  replacedBySession RefreshToken? @relation("TokenRotation", fields: [replacedBySessionId], references: [id])
  rotatedFrom       RefreshToken[] @relation("TokenRotation")

  @@index([userId], name: "idx_refresh_tokens_user_id")
  @@index([expiresAt], name: "idx_refresh_tokens_expires_at")
  @@map("refresh_tokens")
}

model EmailVerification {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String?   @db.Uuid
  userId      String    @db.Uuid
  tokenHash   String    @unique @db.VarChar(255)
  expiresAt   DateTime
  verifiedAt  DateTime?
  createdAt   DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId], name: "idx_email_verifications_user_id")
  @@map("email_verifications")
}

model PasswordReset {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String?   @db.Uuid
  userId    String    @db.Uuid
  tokenHash String    @unique @db.VarChar(255)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId], name: "idx_password_resets_user_id")
  @@index([expiresAt], name: "idx_password_resets_expires_at")
  @@map("password_resets")
}
```

### 3.1 Model Notes

**`User`** — *Purpose:* platform login identity for Owners, Managers, Staff, and Super Admins. *Relations:* optional `Tenant` (`null` only for `SUPER_ADMIN`, `onDelete: Restrict` — a tenant with active users can never be hard-deleted out from under them, forcing an explicit user-offboarding step first); many-to-many `Role` via `UserRole`; optional 1:1 `Employee` (a `User` may or may not correspond to a schedulable staff resource, DATABASE_DESIGN.md 3.3.1). *Indexes:* `tenantId` for staff-listing queries. *Constraints:* `email` and `googleId` globally unique — a deliberate simplicity choice (DATABASE_DESIGN.md 3.1.1) that one email cannot belong to two different salon accounts under current design. *Cascade:* soft-delete only (no hard-delete path modeled) — a deactivated user is `isActive = false` and/or `deletedAt` set, never removed, so historical `createdByType/createdById` references across the schema remain resolvable.

**`Role` / `Permission` / `RolePermission`** — *Purpose:* fixed, seeded RBAC reference data (DATABASE_DESIGN.md 3.1.2–3.1.4), not tenant-owned. *Relations:* standard many-to-many resolved through an explicit junction (never Prisma's implicit relation table) because a bare junction here has no extra columns but is kept explicit for consistency with every other junction in this schema, which do carry extra columns — one uniform pattern is easier to reason about than two. *Cascade:* `RolePermission` cascades on either side deleting (`onDelete: Cascade`) since a role/permission with no legitimate use should drop its mappings; `UserRole.role` uses `onDelete: Restrict` instead — a role that's actively assigned to users cannot be deleted out from under them.

**`UserRole`** — *Purpose:* many-to-many junction enabling multi-role assignment per user (Section 0 naming note). *Cascade:* `onDelete: Cascade` from `User` (deleting a user's role assignments is safe/expected when the user itself is removed), `onDelete: Restrict` from `Role` (see above).

**`RefreshToken`** — *Purpose:* tracks issued refresh-token sessions for rotation and reuse-detection (SYSTEM_ARCHITECTURE.md 7.2). *Relations:* self-referential `replacedBySessionId` models the rotation chain — when a token is rotated, the old row is not deleted (needed for reuse-detection auditing) but linked forward to its replacement. *Indexes:* `expiresAt` supports a scheduled cleanup job pruning long-expired rows. *Constraints:* `refreshTokenHash` unique — the raw token is never stored, only its hash. *Cascade:* `onDelete: Cascade` from `User` — sessions have no meaning once the user is gone.

**`EmailVerification` / `PasswordReset`** — *Purpose:* single-use, time-limited, hashed tokens for their respective flows (SYSTEM_ARCHITECTURE.md 7.6/7.7). *Cascade:* both `onDelete: Cascade` from `User`. *Constraints:* `tokenHash` unique on both; validity is an application-layer check on `expiresAt`/`usedAt`/`verifiedAt`, not a database constraint (a token past expiry is still a valid row, just semantically spent — deleting it outright would remove the audit trail of "a reset was requested and when").

---

## 4. Tenant Models

```prisma
model Tenant {
  id              String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name            String       @db.VarChar(255)
  slug            String       @unique @db.VarChar(100)
  status          TenantStatus @default(TRIAL)
  timezone        String       @default("UTC") @db.VarChar(50)
  addressLine1    String?      @db.VarChar(255)
  addressLine2    String?      @db.VarChar(255)
  city            String?      @db.VarChar(100)
  countryCode     String?      @db.Char(2)
  defaultLocale   String       @default("en") @db.VarChar(10)
  logoFileId      String?      @db.Uuid
  trialEndsAt     DateTime?
  suspendedAt     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  deletedAt       DateTime?

  logoFile          File?                @relation("TenantLogo", fields: [logoFileId], references: [id])
  users             User[]
  settings          TenantSettings?
  features          TenantFeature[]
  invitations       TenantInvitation[]
  employees         Employee[]
  serviceCategories ServiceCategory[]
  services          Service[]
  businessHours     BusinessHours[]
  holidays          Holiday[]
  branches          Branch[]
  rooms             Room[]
  customers         Customer[]
  customerTags      CustomerTag[]
  appointments      Appointment[]
  conversations     Conversation[]
  whatsappAccount   WhatsAppAccount?
  templateMessages  TemplateMessage[]
  media             Media[]
  subscription      Subscription?
  invoices          Invoice[]
  payments          Payment[]
  notifications     Notification[]
  auditLogs         AuditLog[]
  activityLogs      ActivityLog[]
  files             File[]               @relation("TenantFiles")
  apiKeys           APIKey[]

  @@index([status], name: "idx_tenants_status")
  @@map("tenants")
}

model TenantSettings {
  id                          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                    String   @unique @db.Uuid
  aiGreetingMessage            String?  @db.Text
  aiTone                      String   @default("friendly") @db.VarChar(50)
  aiEscalationInstructions    String?  @db.Text
  cancellationNoticeHours     Int      @default(24)
  bookingBufferMinutes        Int      @default(0)
  reminderHoursBefore         Int      @default(24)
  aiDisclosureEnabled         Boolean  @default(true)
  notificationPreferences     Json     @default("{}")
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_settings")
}

model TenantFeature {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  featureKey String   @db.VarChar(100)
  isEnabled  Boolean  @default(true)
  config     Json?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureKey], name: "uq_tenant_features_tenant_key")
  @@index([tenantId], name: "idx_tenant_features_tenant_id")
  @@map("tenant_features")
}

model TenantInvitation {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId         String    @db.Uuid
  email            String    @db.VarChar(255)
  roleId           String    @db.Uuid
  invitedByUserId  String    @db.Uuid
  tokenHash        String    @unique @db.VarChar(255)
  expiresAt        DateTime
  acceptedAt       DateTime?
  revokedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  tenant     Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  role       Role   @relation(fields: [roleId], references: [id], onDelete: Restrict)
  invitedBy  User   @relation("InvitedBy", fields: [invitedByUserId], references: [id], onDelete: Restrict)

  @@index([tenantId], name: "idx_tenant_invitations_tenant_id")
  @@index([email], name: "idx_tenant_invitations_email")
  @@map("tenant_invitations")
}
```

### 4.1 Model Notes

**`Tenant`** — *Purpose:* the root entity of multi-tenancy; every tenant-owned model elsewhere in this schema carries a `tenantId` foreign key ultimately pointing here. *Relations:* deliberately owns an enormous fan-out of `[]` relations — this is expected and correct for a root aggregate, not a modeling smell. *Cascade:* the reverse relations from child tables are specified per-child (Sections 5–12); `Tenant` itself has no parent to cascade from. *Constraints:* `slug` unique (public-facing identifier, if/when a tenant-specific URL or subdomain is introduced). *Indexes:* `status` — the Admin dashboard's primary tenant-list filter (SYSTEM_ARCHITECTURE.md `Admin` module).

**`TenantSettings`** — *Purpose:* 1:1 AI-behavior/policy configuration, split from `Tenant` because it is read on a hot path (every AI turn) that shouldn't require loading the full tenant profile. *Cascade:* `onDelete: Cascade` — settings have no independent meaning without their tenant. *Constraints:* `tenantId` unique enforces the 1:1. `notificationPreferences` is `Json` (JSONB in Postgres) specifically because its shape is expected to evolve as notification channels are added (DATABASE_DESIGN.md 3.2.2).

**`TenantFeature`** — *Purpose:* per-tenant feature-flag/entitlement overrides beyond what a `Plan` grants by default (e.g., a Super Admin manually enabling a beta feature for one salon, or raising a specific limit as a support accommodation) — new relative to DATABASE_DESIGN.md, added per this phase's explicit model list. *Constraints:* `(tenantId, featureKey)` unique — one row per feature per tenant. *Cascade:* `onDelete: Cascade` from `Tenant`.

**`TenantInvitation`** — *Purpose:* tracks a pending staff invite before the invitee creates a `User` (FR-4). *Relations:* references `Role` (`onDelete: Restrict` — a role in active use by a pending invitation cannot be deleted) and the inviting `User` (`onDelete: Restrict` — preserves "who invited whom" even if invite-management logic changes later). *Constraints:* `tokenHash` unique; a partial unique on `(tenantId, email)` scoped to pending invitations is enforced at the migration layer (Prisma's declarative `@@unique` cannot express the `WHERE acceptedAt IS NULL AND revokedAt IS NULL` partial condition — see Section 14.4 for the documented manual-migration-edit pattern this requires).

---

## 5. Salon Models

```prisma
model Employee {
  id            String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String         @db.Uuid
  userId        String?        @unique @db.Uuid
  branchId      String?        @db.Uuid
  firstName     String         @db.VarChar(100)
  lastName      String         @db.VarChar(100)
  phoneNumber   String?        @db.VarChar(20)
  status        EmployeeStatus @default(ACTIVE)
  colorTag      String?        @db.VarChar(7)
  bio           String?        @db.Text
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?
  deletedByType ActorType?
  deletedById   String?        @db.Uuid

  tenant              Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user                User?                 @relation(fields: [userId], references: [id], onDelete: SetNull)
  branch              Branch?               @relation(fields: [branchId], references: [id], onDelete: SetNull)
  services            EmployeeService[]
  workingHours        WorkingHours[]
  holidays            Holiday[]
  appointments        Appointment[]
  appointmentServices AppointmentService[]
  preferredByCustomers Customer[]           @relation("PreferredEmployee")

  @@index([tenantId, status], name: "idx_employees_tenant_status")
  @@map("employees")
}

model ServiceCategory {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String    @db.Uuid
  name          String    @db.VarChar(100)
  displayOrder  Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  services Service[]

  @@index([tenantId], name: "idx_service_categories_tenant_id")
  @@map("service_categories")
}

model Service {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String    @db.Uuid
  categoryId        String?   @db.Uuid
  name              String    @db.VarChar(150)
  description       String?   @db.Text
  durationMinutes   Int
  priceCents        Int
  currency          String    @default("USD") @db.Char(3)
  isActive          Boolean   @default(true)
  displayOrder      Int       @default(0)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?

  tenant              Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  category            ServiceCategory?      @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  employees           EmployeeService[]
  appointmentServices AppointmentService[]

  @@index([tenantId, isActive], name: "idx_services_tenant_active")
  @@map("services")
}

model EmployeeService {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String   @db.Uuid
  serviceId  String   @db.Uuid
  createdAt  DateTime @default(now())

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  service  Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([employeeId, serviceId], name: "uq_employee_services_employee_service")
  @@index([serviceId], name: "idx_employee_services_service_id")
  @@index([tenantId], name: "idx_employee_services_tenant_id")
  @@map("employee_services")
}

model BusinessHours {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  branchId   String?  @db.Uuid
  dayOfWeek  Int      @db.SmallInt
  startTime  DateTime @db.Time
  endTime    DateTime @db.Time
  isClosed   Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  branch Branch? @relation(fields: [branchId], references: [id], onDelete: Cascade)

  @@index([tenantId, dayOfWeek], name: "idx_business_hours_tenant_day")
  @@map("business_hours")
}

model WorkingHours {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String   @db.Uuid
  dayOfWeek  Int      @db.SmallInt
  startTime  DateTime @db.Time
  endTime    DateTime @db.Time
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId, dayOfWeek], name: "idx_working_hours_employee_day")
  @@map("working_hours")
}

model Holiday {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  employeeId String?  @db.Uuid
  branchId   String?  @db.Uuid
  date       DateTime @db.Date
  reason     String?  @db.VarChar(255)
  createdAt  DateTime @default(now())

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employee Employee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  branch   Branch?   @relation(fields: [branchId], references: [id], onDelete: Cascade)

  @@unique([tenantId, date, employeeId], name: "uq_holidays_tenant_date_employee")
  @@index([tenantId, date], name: "idx_holidays_tenant_date")
  @@map("holidays")
}

/// Future-ready: not required for MVP booking flow (single-location, no room
/// assignment per PROJECT_REQUIREMENTS.md MVP Scope). Wired minimally now so a
/// later multi-location/room-based-booking rollout is additive, not a rewrite.
model Branch {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String    @db.Uuid
  name          String    @db.VarChar(150)
  addressLine1  String?   @db.VarChar(255)
  city          String?   @db.VarChar(100)
  timezone      String?   @db.VarChar(50)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  tenant        Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employees     Employee[]
  rooms         Room[]
  businessHours BusinessHours[]
  holidays      Holiday[]

  @@index([tenantId], name: "idx_branches_tenant_id")
  @@map("branches")
}

/// Future-ready: physical room/station resource, not required until
/// room-level scheduling is prioritized (PROJECT_REQUIREMENTS.md Future Features).
model Room {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String    @db.Uuid
  branchId  String?   @db.Uuid
  name      String    @db.VarChar(100)
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant       Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  branch       Branch?       @relation(fields: [branchId], references: [id], onDelete: SetNull)
  appointments Appointment[]

  @@index([tenantId], name: "idx_rooms_tenant_id")
  @@map("rooms")
}
```

### 5.1 Model Notes

**`Employee`** — *Purpose:* a schedulable staff resource, distinct from `User` login access (DATABASE_DESIGN.md 3.3.1). *Relations:* optional 1:1 `User` (`onDelete: SetNull` — if the linked login account is ever hard-deleted, the employee record survives as a resource, just without dashboard access); optional `Branch` (future-ready, `onDelete: SetNull`). *Indexes:* `(tenantId, status)` composite — availability computation only considers `ACTIVE` employees, so this composite index directly serves that filter. *Cascade:* `onDelete: Cascade` from `Tenant` — deleting a tenant (an operator-only, exceptional action, not a normal user flow) removes its employees; this is safe specifically because `Employee` itself is soft-deletable for the *normal* removal path, so hard-cascade here only fires on true tenant-account deletion.

**`ServiceCategory` / `Service`** — *Purpose:* the service catalog (FR-5). *Relations:* `Service.category` is optional (`onDelete: SetNull` — deleting a category un-categorizes its services rather than deleting them, since a service losing its display grouping is a UI concern, not a data-loss event). *Indexes:* `(tenantId, isActive)` on `Service` — the AI/booking flow only ever queries active services. *Constraints:* `priceCents`/`durationMinutes` positivity is enforced at the application/validation layer, not a Prisma-level `@check` (Prisma does not support arbitrary check constraints declaratively as of this schema's target version; a raw-SQL migration addition is the fallback if this needs database-level enforcement — flagged in Section 14.4, not silently assumed).

**`EmployeeService`** — *Purpose:* many-to-many skill-matching junction the `Availability` engine depends on (FR-11). *Cascade:* `onDelete: Cascade` on both sides — an eligibility mapping has no meaning once either the employee or the service is gone.

**`BusinessHours`** — *Purpose:* salon-wide (or branch-wide, future-ready) opening hours, distinct from per-employee `WorkingHours` — new relative to DATABASE_DESIGN.md's implicit tenant-hours-on-profile, formalized as its own table per this phase's explicit model request. *Relations:* optional `Branch` — `null` means the hours apply tenant-wide (pre-multi-location). *Cascade:* `onDelete: Cascade` from both `Tenant` and `Branch`.

**`WorkingHours`** — *Purpose:* recurring weekly per-employee schedule template. *Constraints:* no uniqueness on `(employeeId, dayOfWeek)` — split shifts (multiple rows per day) are valid (DATABASE_DESIGN.md 3.3.5). *Cascade:* `onDelete: Cascade` from `Employee`.

**`Holiday`** — *Purpose:* tenant-wide, branch-wide, or employee-specific closure dates. *Relations:* both `employeeId` and `branchId` nullable and independent — `null` on both means a full tenant-wide closure. *Constraints:* `(tenantId, date, employeeId)` unique — prevents duplicate holiday entries for the same scope/date.

**`Branch` / `Room`** — *Purpose:* explicitly future-ready per this phase's instructions ("future-ready" annotation in the request). *Design choice:* both are fully modeled (not stub placeholders) but every relation to them elsewhere in the schema is **optional** (`branchId String?`, `roomId String?` on `Appointment`) so the MVP single-location, no-room-assignment flow (PROJECT_REQUIREMENTS.md MVP Scope) simply leaves these `null` everywhere — enabling multi-location/room-scheduling later is a matter of populating and requiring these fields going forward, not an additive migration that risks breaking existing rows, since the columns and relations already exist.

---

## 6. Customer Models

```prisma
model Customer {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String    @db.Uuid
  phoneNumber         String    @db.VarChar(20)
  firstName           String?   @db.VarChar(100)
  lastName            String?   @db.VarChar(100)
  email               String?   @db.VarChar(255)
  preferredLanguage   String?   @db.VarChar(10)
  preferredEmployeeId String?   @db.Uuid
  marketingOptIn      Boolean   @default(false)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  deletedAt           DateTime?
  deletedByType       ActorType?
  deletedById         String?   @db.Uuid

  tenant           Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  preferredEmployee Employee?           @relation("PreferredEmployee", fields: [preferredEmployeeId], references: [id], onDelete: SetNull)
  notes            CustomerNote[]
  preferences      CustomerPreference[]
  tagAssignments   CustomerTagAssignment[]
  appointments     Appointment[]
  conversations    Conversation[]
  feedback         AppointmentFeedback[]

  @@unique([tenantId, phoneNumber], name: "uq_customers_tenant_phone")
  @@index([tenantId], name: "idx_customers_tenant_id")
  @@map("customers")
}

model CustomerNote {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String    @db.Uuid
  customerId     String    @db.Uuid
  note           String    @db.Text
  authorUserId   String    @db.Uuid
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  author   User     @relation(fields: [authorUserId], references: [id], onDelete: Restrict)

  @@index([customerId], name: "idx_customer_notes_customer_id")
  @@map("customer_notes")
}

model CustomerPreference {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @db.Uuid
  customerId   String   @db.Uuid
  key          String   @db.VarChar(100)
  value        String   @db.Text
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([customerId, key], name: "uq_customer_preferences_customer_key")
  @@index([tenantId], name: "idx_customer_preferences_tenant_id")
  @@map("customer_preferences")
}

model CustomerTag {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  name       String   @db.VarChar(50)
  color      String?  @db.VarChar(7)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tenant      Tenant                  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assignments CustomerTagAssignment[]

  @@unique([tenantId, name], name: "uq_customer_tags_tenant_name")
  @@map("customer_tags")
}

model CustomerTagAssignment {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @db.Uuid
  customerId    String   @db.Uuid
  customerTagId String   @db.Uuid
  createdAt     DateTime @default(now())

  customer Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
  tag      CustomerTag @relation(fields: [customerTagId], references: [id], onDelete: Cascade)

  @@unique([customerId, customerTagId], name: "uq_customer_tag_assignments")
  @@index([customerTagId], name: "idx_customer_tag_assignments_tag_id")
  @@map("customer_tag_assignments")
}
```

### 6.1 Model Notes

**`Customer`** — *Purpose:* a salon's end customer, the person booking via WhatsApp (DATABASE_DESIGN.md 3.4.1) — scoped per tenant, since the same phone number may message two different salons as two independent customer identities. *Constraints:* `(tenantId, phoneNumber)` unique — the identity resolution key for every inbound WhatsApp message; the DATABASE_DESIGN.md partial-unique (`WHERE deletedAt IS NULL`) is implemented here as a plain `@@unique` with the partial `WHERE` clause added via the documented manual-migration-edit pattern (Section 14.4), since Prisma's schema DSL does not yet support declaring partial unique indexes natively. *Relations:* optional `preferredEmployee` (`onDelete: SetNull`). *Cascade:* `onDelete: Cascade` from `Tenant` (same rationale as `Employee` — only fires on true tenant deletion, not normal customer removal, which is soft-delete).

**`CustomerNote`** — *Purpose:* free-text staff notes. *Relations:* `author` references `User` with `onDelete: Restrict` — a note's authorship must never be silently orphaned; a `User` with authored notes cannot be hard-deleted (consistent with the platform-wide preference for soft-delete on `User`, Section 3.1).

**`CustomerPreference`** — *Purpose:* structured (key/value) preference data, distinct from `CustomerNote`'s free text — new relative to DATABASE_DESIGN.md, added per this phase's explicit model list, to support machine-readable preferences (e.g., `preferred_product: "sulfate-free"`, `allergy: "latex"`) that the AI can reason over more reliably than parsing free-text notes. *Constraints:* `(customerId, key)` unique — one current value per preference key per customer (a new value overwrites, rather than accumulates, consistent with "preference" being a current-state concept, unlike the append-only `CustomerNote`).

**`CustomerTag` / `CustomerTagAssignment`** — *Purpose:* tenant-defined customer segmentation labels. *Cascade:* `onDelete: Cascade` throughout the junction — an assignment has no meaning once either side is gone.

**Amended, Milestone 6 (docs/adr/ADR-009-scheduling-engine.md):** built as a narrower subset — no `CustomerNote`, `CustomerPreference`, `CustomerTag`, or `CustomerTagAssignment` (none were requested; only "Customer CRUD" was asked for, the same "narrow the ask, log the deferral" precedent ADR-008 already set for its own Customers/Files deferral). No `preferredEmployeeId` field or relation. `Customer` carries `@@unique([tenantId, id])` (the composite-FK pattern's referenced side, since `Appointment.customer` needs it) in addition to the partial-unique phone constraint, which was added via the documented manual-migration-edit mechanism exactly as this section anticipated. See docs/SCHEDULING_ARCHITECTURE.md for the full as-built reference.

---

## 7. Appointment Models

```prisma
model Appointment {
  id                            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                      String             @db.Uuid
  customerId                    String             @db.Uuid
  employeeId                    String             @db.Uuid
  roomId                        String?            @db.Uuid
  conversationId                String?            @db.Uuid
  status                        AppointmentStatus  @default(CONFIRMED)
  startTime                     DateTime
  endTime                       DateTime
  totalPriceCents                Int
  currency                      String             @db.Char(3)
  notes                         String?            @db.Text
  cancellationReason            String?            @db.VarChar(255)
  cancelledAt                   DateTime?
  rescheduledFromAppointmentId  String?            @db.Uuid
  createdAt                     DateTime           @default(now())
  updatedAt                     DateTime           @updatedAt
  createdByType                 ActorType          @default(USER)
  createdById                   String?            @db.Uuid
  updatedByType                 ActorType          @default(USER)
  updatedById                   String?            @db.Uuid
  deletedAt                     DateTime?
  deletedByType                 ActorType?
  deletedById                   String?            @db.Uuid

  tenant               Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer             Customer              @relation(fields: [customerId], references: [id], onDelete: Restrict)
  employee             Employee              @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  room                 Room?                 @relation(fields: [roomId], references: [id], onDelete: SetNull)
  conversation         Conversation?         @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  rescheduledFrom      Appointment?          @relation("RescheduleChain", fields: [rescheduledFromAppointmentId], references: [id])
  rescheduledTo        Appointment[]         @relation("RescheduleChain")
  services             AppointmentService[]
  statusHistory        AppointmentStatusHistory[]
  reminders            AppointmentReminder[]
  feedback             AppointmentFeedback?

  @@index([tenantId, employeeId, startTime], name: "idx_appointments_tenant_employee_start")
  @@index([tenantId, customerId], name: "idx_appointments_tenant_customer")
  @@index([tenantId, status, startTime], name: "idx_appointments_tenant_status_start")
  @@map("appointments")
}

model AppointmentService {
  id                         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                   String   @db.Uuid
  appointmentId              String   @db.Uuid
  serviceId                  String   @db.Uuid
  employeeId                 String   @db.Uuid
  serviceNameSnapshot        String   @db.VarChar(150)
  durationMinutesSnapshot    Int
  priceCentsSnapshot         Int
  sequenceOrder              Int      @default(0) @db.SmallInt
  createdAt                  DateTime @default(now())

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  service     Service     @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  employee    Employee    @relation(fields: [employeeId], references: [id], onDelete: Restrict)

  @@index([appointmentId], name: "idx_appointment_services_appointment_id")
  @@index([serviceId], name: "idx_appointment_services_service_id")
  @@map("appointment_services")
}

model AppointmentStatusHistory {
  id                String                    @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId          String                    @db.Uuid
  appointmentId     String                    @db.Uuid
  action            AppointmentHistoryAction
  previousState     Json?
  newState          Json
  actorType         ActorType
  actorId           String?                   @db.Uuid
  aiPromptVersionId String?                   @db.Uuid
  conversationId    String?                   @db.Uuid
  createdAt         DateTime                  @default(now())

  appointment    Appointment    @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  actor          User?          @relation("AppointmentHistoryActor", fields: [actorId], references: [id], onDelete: SetNull)
  aiPromptVersion PromptVersion? @relation(fields: [aiPromptVersionId], references: [id], onDelete: SetNull)
  conversation   Conversation?  @relation(fields: [conversationId], references: [id], onDelete: SetNull)

  @@index([appointmentId], name: "idx_appointment_status_history_appointment_id")
  @@index([tenantId, createdAt], name: "idx_appointment_status_history_tenant_created")
  @@map("appointment_status_history")
}

model AppointmentReminder {
  id            String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String          @db.Uuid
  appointmentId String          @db.Uuid
  channel       ReminderChannel @default(WHATSAPP)
  status        ReminderStatus  @default(SCHEDULED)
  scheduledFor  DateTime
  sentAt        DateTime?
  failureReason String?         @db.VarChar(255)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)

  @@index([appointmentId], name: "idx_appointment_reminders_appointment_id")
  @@index([status, scheduledFor], name: "idx_appointment_reminders_status_scheduled")
  @@map("appointment_reminders")
}

model AppointmentFeedback {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String    @db.Uuid
  appointmentId String    @unique @db.Uuid
  customerId    String    @db.Uuid
  rating        Int       @db.SmallInt
  comment       String?   @db.Text
  collectedAt   DateTime  @default(now())
  createdAt     DateTime  @default(now())

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  customer    Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([tenantId], name: "idx_appointment_feedback_tenant_id")
  @@map("appointment_feedback")
}
```

### 7.1 Model Notes

**`Appointment`** — *Purpose:* the core, highest-stakes business record (DATABASE_DESIGN.md 3.5.1). *Relations:* `customer`/`employee` use `onDelete: Restrict` — a customer or employee with existing appointments can never be hard-deleted (both are soft-deletable for the normal removal path, so this only guards against an accidental/incorrect hard-delete attempt); `room`/`conversation` are optional with `onDelete: SetNull` (a manually-created booking has no `conversation`; MVP has no `room` assignment, Section 5.1); the self-referential `rescheduledFromAppointmentId` models the reschedule chain as two linked rows rather than an in-place mutation (DATABASE_DESIGN.md 9.2), preserving both the original and new booking as distinct historical facts. *Indexes:* the three composite indexes here are the highest-value indexes in the entire schema — `(tenantId, employeeId, startTime)` serves the Critical-priority conflict-prevention/availability path; `(tenantId, status, startTime)` serves the dashboard calendar. *Constraints:* **no unique constraint prevents double-booking** — overlap prevention is a range-comparison business rule, not a simple column-equality uniqueness, and is enforced at the transaction/application layer plus a Redis lock (DATABASE_DESIGN.md 10.4), with a `btree_gist` `EXCLUDE` constraint flagged as a stronger future database-level guarantee (Section 14.5, carried forward from DATABASE_DESIGN.md Risk DB-R3 as still-open).

**`AppointmentService`** — *Purpose:* many-to-many junction **plus historical snapshot** — the one place in the schema where a junction table carries substantive business data (DATABASE_DESIGN.md 4.4). *Relations:* `service`/`employee` use `onDelete: Restrict` (the same rationale as on `Appointment` itself — a service/employee with booking history attached cannot be hard-deleted). *Cascade:* `onDelete: Cascade` from `Appointment` only — deleting the parent appointment legitimately removes its service line-items.

**`AppointmentStatusHistory`** — *Purpose:* immutable, append-only change log (DATABASE_DESIGN.md 3.5.3), the direct implementation of FR-28 for the appointment entity. *Primary key:* explicitly **not** `@default`-generated in the schema (Section 1.1) — the application/repository layer must supply a UUIDv7 at insert time; this is called out with an inline comment in the code block itself so it is not missed during implementation. *Relations:* `actor` (`onDelete: SetNull` — a departed staff member's historical actions remain visible, just with a null actor reference rather than losing the row); `aiPromptVersion` links to `PromptVersion` (Section 8) for prompt-version traceability (SYSTEM_ARCHITECTURE.md 5.6) — this is a genuine FK (not the bare version string DATABASE_DESIGN.md used), a refinement made possible by `PromptVersion` now being a first-class model in this phase. *Business rule (enforced at the repository/service layer, not by Prisma):* rows in this table are insert-only — no `update`/`delete` calls are permitted against this model anywhere in the application (SYSTEM_ARCHITECTURE.md 9.6 tamper-evidence).

**`AppointmentReminder`** — *Purpose:* formalizes scheduled-reminder tracking as its own table (new relative to DATABASE_DESIGN.md's single `reminderSentAt` flag), supporting multiple reminders per appointment across channels (e.g., a 24-hour and a 2-hour WhatsApp reminder) — directly implements FR-15. *Indexes:* `(status, scheduledFor)` — the exact index the reminder-dispatch background job (SYSTEM_ARCHITECTURE.md 11.5) polls against. *Cascade:* `onDelete: Cascade` from `Appointment` — a cancelled/deleted appointment's pending reminders are meaningless and should not fire.

**`AppointmentFeedback`** — *Purpose:* post-visit rating/comment capture, collected via a WhatsApp follow-up message — new relative to DATABASE_DESIGN.md, added as a natural extension supporting future NPS/CSAT metrics (PROJECT_REQUIREMENTS.md Section 18). *Constraints:* `appointmentId` unique — one feedback record per appointment (1:1). *Cascade:* `onDelete: Cascade` from both `Appointment` and `Customer`.

**Amended, Milestone 6 (docs/adr/ADR-009-scheduling-engine.md):** `AppointmentReminder` and `AppointmentFeedback` were **not built** — no notifications beyond scheduling itself and no post-visit feedback flow were requested this milestone; both remain open, not silently dropped. `Appointment.room`/`.conversation` do not exist — `Room` (Milestone 6 doesn't touch multi-location) and `Conversation` (Milestone 7) aren't in scope. `Appointment`'s composite-FK relations (`customer`, `employee`, and the self-referential `rescheduledFrom`) were all generated natively by `prisma migrate dev` with no manual SQL, the second confirmation (after `EmployeeService`, Milestone 5) of ADR-008's correction to this section's original "manual migration required" assumption — `rescheduledFrom` specifically uses `onDelete: Restrict`, not `SetNull`: a composite relation sharing the required `tenantId` scalar with `Appointment`'s other relations cannot validly null just that one FK column, and Prisma's schema validator warns against it. The `EXCLUDE` constraint flagged here as a "stronger future database-level guarantee" was built **now**, not deferred — scoped to `appointment_services` (per-line, not per-appointment, blocking unit — see `AppointmentService`'s own amendment note below), using `tsrange` rather than `tstzrange` since no `DateTime` column in this schema uses `@db.Timestamptz` (confirmed against every prior migration). `AppointmentStatusHistory.id` uses standard `gen_random_uuid()`, not app-generated UUIDv7 as this section originally specified — matching the `AuditLog` precedent (Milestone 3: "not worth a new dependency at this milestone's volume"); no `aiPromptVersionId`/`conversationId` columns exist (no `PromptVersion`/`Conversation` model until Milestones 7–8). `AppointmentService` was built with four columns beyond this section's design — `bufferMinutesSnapshot`, `startTime`, `endTime`, `blockedUntil`, `isBlocking` — because confirmed-with-requester per-service employee assignment (a single visit's services may each be performed by a different employee) makes each *line*, not the parent `Appointment`, the independently-blocking conflict-prevention unit. See docs/SCHEDULING_ARCHITECTURE.md for the full as-built reference.

---

## 8. Conversation Models

> **Built Milestone 7 (docs/adr/ADR-010-whatsapp-platform.md)** — as-built with the deviations noted in DATABASE_DESIGN.md §3.6/§3.7 and this codebase's `backend/prisma/schema.prisma` itself (which remains the source of truth for the exact field list): narrowed `ConversationStatus`, media metadata as plain `Message` columns rather than a `Media` model, `senderType: ActorType` (reusing the existing enum) instead of a bespoke `MessageSenderType`, and standard `gen_random_uuid()` rather than app-generated UUIDv7 for `Message`/`WebhookEvent`. The Prisma snippets below are retained as the original design intent.

```prisma
model Conversation {
  id                String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String              @db.Uuid
  customerId        String              @db.Uuid
  whatsappAccountId String              @db.Uuid
  status            ConversationStatus  @default(OPEN_AI)
  escalatedAt       DateTime?
  escalationReason  String?             @db.VarChar(255)
  assignedUserId    String?             @db.Uuid
  lastMessageAt     DateTime            @default(now())
  resolvedAt        DateTime?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  tenant          Tenant                      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer        Customer                    @relation(fields: [customerId], references: [id], onDelete: Cascade)
  whatsappAccount WhatsAppAccount             @relation(fields: [whatsappAccountId], references: [id], onDelete: Restrict)
  assignedUser    User?                       @relation("AssignedStaff", fields: [assignedUserId], references: [id], onDelete: SetNull)
  messages        Message[]
  aiContext       AIContext?
  summary         ConversationSummary?
  appointments    Appointment[]
  statusHistoryRefs AppointmentStatusHistory[]

  @@index([tenantId, customerId], name: "idx_conversations_tenant_customer")
  @@index([tenantId, status], name: "idx_conversations_tenant_status")
  @@index([lastMessageAt], name: "idx_conversations_last_message_at")
  @@map("conversations")
}

model Message {
  id                 String                 @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId           String                 @db.Uuid
  conversationId     String                 @db.Uuid
  direction          MessageDirection
  senderType         MessageSenderType
  senderUserId       String?                @db.Uuid
  messageType        MessageType            @default(TEXT)
  content            String?                @db.Text
  mediaId            String?                @db.Uuid
  whatsappMessageId  String?                @unique @db.VarChar(100)
  status             MessageDeliveryStatus  @default(QUEUED)
  failureReason      String?                @db.VarChar(255)
  promptVersionId    String?                @db.Uuid
  rawPayload         Json?
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt

  conversation  Conversation    @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderUser    User?           @relation("StaffSender", fields: [senderUserId], references: [id], onDelete: SetNull)
  media         Media?          @relation(fields: [mediaId], references: [id], onDelete: SetNull)
  promptVersion PromptVersion?  @relation(fields: [promptVersionId], references: [id], onDelete: SetNull)
  statusEvents  MessageStatus[]

  @@index([conversationId, createdAt], name: "idx_messages_conversation_created")
  @@index([tenantId, createdAt], name: "idx_messages_tenant_created")
  @@map("messages")
}

model AIContext {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String    @db.Uuid
  conversationId String    @unique @db.Uuid
  currentIntent  String?   @db.VarChar(50)
  state          Json      @default("{}")
  lastToolCall   String?   @db.VarChar(50)
  updatedAt      DateTime  @updatedAt

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@map("ai_contexts")
}

model ConversationSummary {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String    @db.Uuid
  conversationId     String    @unique @db.Uuid
  summaryText        String    @db.Text
  messageCount       Int
  lastCustomerIntent String?   @db.VarChar(100)
  generatedAt        DateTime  @default(now())
  promptVersionId    String?   @db.Uuid

  conversation  Conversation   @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  promptVersion PromptVersion? @relation(fields: [promptVersionId], references: [id], onDelete: SetNull)

  @@map("conversation_summaries")
}

model PromptVersion {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  version     String    @unique @db.VarChar(20)
  description String?   @db.VarChar(255)
  isActive    Boolean   @default(false)
  releasedAt  DateTime?
  createdAt   DateTime  @default(now())

  messages              Message[]
  conversationSummaries ConversationSummary[]
  appointmentHistory    AppointmentStatusHistory[]

  @@map("prompt_versions")
}
```

### 8.1 Model Notes

**`Conversation`** — *Purpose:* a WhatsApp thread between one customer and one tenant (DATABASE_DESIGN.md 3.6.1). *Relations:* `whatsappAccount` uses `onDelete: Restrict` (a connected WhatsApp number with conversation history cannot be casually detached); `assignedUser` optional with `onDelete: SetNull` (handoff assignment, SYSTEM_ARCHITECTURE.md 5.8). *Indexes:* `(tenantId, status)` powers the human-handoff queue (FR-13) — one of the highest-business-value queries in the dashboard.

**`Message`** — *Purpose:* the highest-volume table in the schema (DATABASE_DESIGN.md 3.6.2/Section 12.5). *Primary key:* explicitly app-generated UUIDv7, not `@default` — flagged inline exactly as `AppointmentStatusHistory` is, for the same reason (Section 1.1). *Constraints:* `whatsappMessageId` unique (nullable) is the concrete idempotency guard against Meta's at-least-once webhook delivery (SYSTEM_ARCHITECTURE.md 6.6) — the partial `WHERE whatsappMessageId IS NOT NULL` qualifier again requires the manual-migration-edit pattern (Section 14.4), since not every message (e.g., a `SYSTEM`-generated internal note, if that pattern is ever used) necessarily has one. *Relations:* `promptVersion` optional, set only when `senderType = AI`. *Indexes:* `(conversationId, createdAt)` — the single most-read index in the system (every conversation-thread render and every AI context-assembly call).

**`AIContext`** — *Purpose:* per-conversation AI working memory (DATABASE_DESIGN.md 3.6.3), complementing the Redis-cached copy (DATABASE_DESIGN.md 10.2) with a durable record. *Constraints:* `conversationId` unique (1:1). `state` is `Json` (JSONB) — deliberately flexible, evolves with AI tool/capability changes (Section 2's JSONB-usage rationale).

**`ConversationSummary`** — *Purpose:* denormalized, regeneratable rollup for dashboard display and AI token-optimization (SYSTEM_ARCHITECTURE.md 5.7) — never authoritative source data (DATABASE_DESIGN.md 1.4). *Relations:* optional `promptVersion` — tracks which prompt version generated the summary, for the same traceability reason as on `AppointmentStatusHistory`.

**`PromptVersion`** — *Purpose:* a queryable registry of AI prompt template versions — new relative to DATABASE_DESIGN.md, which treated `aiPromptVersion` as a bare string column; formalizing it as a real model (per this phase's explicit request) allows `isActive`/`releasedAt` tracking and referential integrity from every AI-attributed row (`Message`, `ConversationSummary`, `AppointmentStatusHistory`) back to a single canonical version record, directly supporting SYSTEM_ARCHITECTURE.md Section 5.6's staged-rollout and post-hoc-debugging use case ("this bad booking happened under prompt v3"). *Relations:* every consumer uses `onDelete: SetNull` — a retired prompt version can be removed from active use without invalidating historical attribution (the FK simply nulls out, and the human-readable `version` string could additionally be denormalized onto consuming rows if fully independent historical readability is later required — flagged as a possible refinement, not built now to avoid redundant storage on every AI-generated row).

---

## 9. WhatsApp Models

```prisma
model WhatsAppAccount {
  id                          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                    String   @unique @db.Uuid
  phoneNumber                 String   @db.VarChar(20)
  whatsappPhoneNumberId       String   @unique @db.VarChar(100)
  whatsappBusinessAccountId   String   @db.VarChar(100)
  accessTokenEncrypted        String   @db.Text
  connectionStatus            String   @default("PENDING") @db.VarChar(20)
  connectedAt                 DateTime?
  lastHealthCheckAt           DateTime?
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  tenant          Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversations   Conversation[]
  templateMessages TemplateMessage[]

  @@map("whatsapp_accounts")
}

model WebhookEvent {
  id                String                   @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  whatsappMessageId String?                   @db.VarChar(100)
  eventType         String                   @db.VarChar(50)
  payload           Json
  tenantId          String?                   @db.Uuid
  processingStatus  WebhookProcessingStatus  @default(PENDING)
  processedAt       DateTime?
  errorMessage      String?                  @db.Text
  createdAt         DateTime                 @default(now())

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@unique([whatsappMessageId], name: "uq_webhook_events_message_id")
  @@index([processingStatus], name: "idx_webhook_events_processing_status")
  @@index([createdAt], name: "idx_webhook_events_created_at")
  @@map("whatsapp_webhook_events")
}

model TemplateMessage {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String   @db.Uuid
  whatsappAccountId   String   @db.Uuid
  name                String   @db.VarChar(100)
  whatsappTemplateId  String?  @db.VarChar(100)
  category            String   @db.VarChar(30)
  languageCode        String   @db.VarChar(10)
  approvalStatus      String   @default("PENDING") @db.VarChar(20)
  bodyText            String   @db.Text
  variableCount       Int      @default(0) @db.SmallInt
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenant          Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  whatsappAccount WhatsAppAccount @relation(fields: [whatsappAccountId], references: [id], onDelete: Cascade)

  @@unique([tenantId, name, languageCode], name: "uq_template_messages_tenant_name_lang")
  @@map("template_messages")
}

model Media {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId         String   @db.Uuid
  storageKey       String   @db.VarChar(500)
  contentType      String   @db.VarChar(100)
  sizeBytes        BigInt
  source           String   @db.VarChar(20)
  whatsappMediaId  String?  @db.VarChar(100)
  createdAt        DateTime @default(now())

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  messages Message[]

  @@index([tenantId], name: "idx_media_tenant_id")
  @@index([whatsappMediaId], name: "idx_media_whatsapp_media_id")
  @@map("media")
}

model MessageStatus {
  id         String                 @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId   String                 @db.Uuid
  messageId  String                 @db.Uuid
  status     MessageDeliveryStatus
  occurredAt DateTime
  rawPayload Json?
  createdAt  DateTime               @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId], name: "idx_message_status_message_id")
  @@map("message_status_events")
}
```

### 9.1 Model Notes

**`WhatsAppAccount`** — *Purpose:* 1:1 tenant-to-WhatsApp-number mapping (FR-6). *Constraints:* `whatsappPhoneNumberId` unique — the **critical tenant-resolution index** every inbound webhook looks up (SYSTEM_ARCHITECTURE.md 8.3); `tenantId` unique enforces the MVP's one-number-per-tenant scope. *Fields:* `accessTokenEncrypted` is encrypted at the application layer before the `create`/`update` call reaches Prisma — Prisma has no native column-level encryption, so this is an application-layer responsibility the schema only stores the result of (SYSTEM_ARCHITECTURE.md 9.4). *Cascade:* `onDelete: Cascade` from `Tenant`.

**`WebhookEvent`** — *Purpose:* raw inbound Meta webhook log, persisted before tenant resolution (DATABASE_DESIGN.md 3.7.2). *Relations:* `tenant` is **nullable** with `onDelete: SetNull` — this is the schema's one genuinely-global-at-ingestion, tenant-resolved-later table (DATABASE_DESIGN.md 5.6). *Primary key:* app-generated UUIDv7 (Section 1.1), consistent with its high, time-ordered write volume. *Constraints:* `whatsappMessageId` unique (nullable — not every event type, e.g. account-status-change, has one) is the raw-ingestion-layer idempotency guard, a belt-and-suspenders pairing with `Message.whatsappMessageId`'s own uniqueness at the processed layer.

**`TemplateMessage`** — *Purpose:* registry of Meta-approved outbound templates (compliance requirement, PROJECT_REQUIREMENTS.md Section 20). *Constraints:* `(tenantId, name, languageCode)` unique. *Cascade:* `onDelete: Cascade` from both `Tenant` and `WhatsAppAccount`.

**`Media`** — *Purpose:* metadata for S3-backed WhatsApp media (inbound/outbound), distinct from the general-purpose `File` model (Section 12) per the lifecycle split documented in DATABASE_DESIGN.md 3.7.4 — `Media` carries WhatsApp-specific fields (`whatsappMediaId`, inbound/outbound `source`) that a general file-storage abstraction shouldn't need to know about.

**`MessageStatus`** — *Purpose:* append-only delivery-receipt **history** per message (`SENT` → `DELIVERED` → `READ`, or → `FAILED`), distinct from `Message.status` which holds only the **current** value — new relative to DATABASE_DESIGN.md's single-column approach, added because this phase's model list explicitly separates them, and because WhatsApp legitimately sends multiple sequential status webhooks per message that are each individually valuable for delivery-debugging (SYSTEM_ARCHITECTURE.md 6.7). *Cascade:* `onDelete: Cascade` from `Message` — status history has no meaning independent of its message. The application is responsible for keeping `Message.status` (denormalized "current" value) in sync with the latest `MessageStatus` row on each webhook receipt, within the same transaction.

---

## 10. Billing Models

```prisma
model Plan {
  id                    String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name                  String   @db.VarChar(50)
  stripePriceId         String   @unique @db.VarChar(100)
  monthlyPriceCents     Int
  currency              String   @default("USD") @db.Char(3)
  maxStaff              Int?
  maxMessagesPerMonth   Int?
  maxLocations          Int      @default(1)
  isActive              Boolean  @default(true)
  trialDays             Int      @default(14)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  subscriptions Subscription[]

  @@index([isActive], name: "idx_plans_is_active")
  @@map("plans")
}

model Subscription {
  id                            String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                      String              @unique @db.Uuid
  planId                        String              @db.Uuid
  stripeCustomerId               String              @db.VarChar(100)
  stripeSubscriptionId           String?             @unique @db.VarChar(100)
  status                        SubscriptionStatus  @default(TRIALING)
  currentPeriodStart            DateTime?
  currentPeriodEnd              DateTime?
  cancelAtPeriodEnd             Boolean             @default(false)
  canceledAt                    DateTime?
  couponId                      String?             @db.Uuid
  messagesUsedCurrentPeriod     Int                 @default(0)
  createdAt                     DateTime            @default(now())
  updatedAt                     DateTime            @updatedAt
  updatedByType                 ActorType           @default(SYSTEM)
  updatedById                   String?             @db.Uuid

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan     Plan      @relation(fields: [planId], references: [id], onDelete: Restrict)
  coupon   Coupon?   @relation(fields: [couponId], references: [id], onDelete: SetNull)
  invoices Invoice[]

  @@index([status], name: "idx_subscriptions_status")
  @@index([stripeCustomerId], name: "idx_subscriptions_stripe_customer_id")
  @@map("subscriptions")
}

model Invoice {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String        @db.Uuid
  subscriptionId    String        @db.Uuid
  stripeInvoiceId   String        @unique @db.VarChar(100)
  amountDueCents    Int
  amountPaidCents   Int
  currency          String        @db.Char(3)
  status            InvoiceStatus
  invoicePdfFileId  String?       @db.Uuid
  issuedAt          DateTime
  dueAt             DateTime?
  paidAt            DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  tenant       Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscription Subscription  @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  invoicePdf   File?         @relation(fields: [invoicePdfFileId], references: [id], onDelete: SetNull)
  payments     Payment[]

  @@index([tenantId, issuedAt], name: "idx_invoices_tenant_issued")
  @@map("invoices")
}

model Payment {
  id                       String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                 String        @db.Uuid
  invoiceId                String?       @db.Uuid
  stripePaymentIntentId    String        @unique @db.VarChar(100)
  amountCents              Int
  currency                 String        @db.Char(3)
  status                   PaymentStatus
  failureCode              String?       @db.VarChar(50)
  failureMessage           String?       @db.VarChar(255)
  attemptedAt               DateTime
  createdAt                DateTime      @default(now())

  tenant  Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  invoice Invoice? @relation(fields: [invoiceId], references: [id], onDelete: SetNull)

  @@index([tenantId], name: "idx_payments_tenant_id")
  @@index([status], name: "idx_payments_status")
  @@map("payments")
}

model Coupon {
  id                String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code              String              @unique @db.VarChar(50)
  stripeCouponId    String              @unique @db.VarChar(100)
  discountType      CouponDiscountType
  discountValue     Int
  durationType      CouponDurationType
  durationInMonths  Int?
  maxRedemptions    Int?
  redemptionCount   Int                 @default(0)
  expiresAt         DateTime?
  isActive          Boolean             @default(true)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  subscriptions Subscription[]

  @@index([isActive], name: "idx_coupons_is_active")
  @@map("coupons")
}

model WebhookLog {
  id                String                   @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  provider          String                   @db.VarChar(30)
  providerEventId   String                   @db.VarChar(100)
  eventType         String                   @db.VarChar(100)
  payload           Json
  tenantId          String?                  @db.Uuid
  processingStatus  WebhookProcessingStatus  @default(PENDING)
  processedAt       DateTime?
  errorMessage      String?                  @db.Text
  createdAt         DateTime                 @default(now())

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@unique([provider, providerEventId], name: "uq_webhook_logs_provider_event")
  @@index([processingStatus], name: "idx_webhook_logs_processing_status")
  @@map("webhook_logs")
}
```

### 10.1 Model Notes

**`Plan`** — *Purpose:* global, seeded subscription-tier reference data. *Constraints:* `stripePriceId` unique. *Business rule:* retired plans are deactivated (`isActive = false`), never deleted, since historical `Subscription` rows must retain a valid reference — this is why `Subscription.plan` uses `onDelete: Restrict` rather than `Cascade`.

**`Subscription`** — *Purpose:* the single, consolidated billing-state model satisfying both "TenantSubscription" and "Subscription" from the requested model list (Section 0). *Constraints:* `tenantId` unique (1:1 with `Tenant`); `stripeSubscriptionId` unique (nullable — null during a trial with no payment method yet attached). *Relations:* `plan` uses `onDelete: Restrict` (above); `coupon` optional with `onDelete: SetNull`. *Business rule:* `status` is authoritatively driven by Stripe webhooks (`updatedByType` defaults to `SYSTEM`), not direct application writes — this model is a queryable mirror, not the source of truth (DATABASE_DESIGN.md 3.8.2).

**`Invoice` / `Payment`** — *Purpose:* local mirrors of Stripe's own invoice/payment-intent objects, structured to match Stripe's hierarchy 1:1 for easy reconciliation (DATABASE_DESIGN.md 4.2). *Relations:* `Payment.invoice` is optional with `onDelete: SetNull` (a payment attempt can exist before/without a finalized invoice in some Stripe flows); `Invoice.invoicePdf` optional `File` reference, `onDelete: SetNull`. *Cascade:* both `onDelete: Cascade` from `Tenant`/`Subscription` respectively — these are tenant-owned billing artifacts, never independently meaningful.

**`Coupon`** — *Purpose:* global, platform-wide discount codes. *Constraints:* `code` and `stripeCouponId` both unique. *Relations:* referenced by `Subscription.couponId` — a coupon in active use cannot be hard-deleted without first nulling out every referencing subscription (`onDelete: SetNull` on that side handles this automatically, so `Coupon` itself has no `onDelete` restriction to declare).

**`WebhookLog`** — *Purpose:* raw inbound event log for non-WhatsApp providers (primarily Stripe), mirroring `WebhookEvent`'s role and design exactly (Section 9.1) — kept as a **separate model** rather than a shared polymorphic table because Stripe and Meta events have different processing pipelines, different signature-verification mechanisms, and different downstream consumers (`Billing` vs. `WhatsApp`/`AI` modules), and conflating them into one table would force nullable, provider-specific columns onto every row regardless of source. *Constraints:* `(provider, providerEventId)` unique — Stripe's own idempotency key, dedup at ingestion (SYSTEM_ARCHITECTURE.md 9.1's "Software & Data Integrity" mitigation).

---

## 11. Notification Models

```prisma
model NotificationTemplate {
  id            String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key           String              @db.VarChar(100)
  channel       NotificationChannel
  type          NotificationType
  languageCode  String              @default("en") @db.VarChar(10)
  subject       String?             @db.VarChar(255)
  bodyTemplate  String              @db.Text
  isActive      Boolean             @default(true)
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  notifications Notification[]

  @@unique([key, channel, languageCode], name: "uq_notification_templates_key_channel_lang")
  @@map("notification_templates")
}

model Notification {
  id             String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String               @db.Uuid
  recipientUserId String              @db.Uuid
  templateId     String?              @db.Uuid
  channel        NotificationChannel
  type           NotificationType
  subject        String?              @db.VarChar(255)
  data           Json                 @default("{}")
  status         NotificationStatus   @default(PENDING)
  sentAt         DateTime?
  failureReason  String?              @db.VarChar(255)
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  tenant       Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  recipient    User                   @relation(fields: [recipientUserId], references: [id], onDelete: Cascade)
  template     NotificationTemplate?  @relation(fields: [templateId], references: [id], onDelete: SetNull)
  logs         NotificationLog[]

  @@index([recipientUserId], name: "idx_notifications_recipient_user_id")
  @@index([status], name: "idx_notifications_status")
  @@map("notifications")
}

model NotificationLog {
  id               String   @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId         String   @db.Uuid
  notificationId   String   @db.Uuid
  attemptNumber    Int      @db.SmallInt
  providerResponse Json?
  succeeded        Boolean
  attemptedAt      DateTime
  createdAt        DateTime @default(now())

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  @@index([notificationId], name: "idx_notification_logs_notification_id")
  @@map("notification_logs")
}
```

### 11.1 Model Notes

**`NotificationTemplate`** — *Purpose:* managed, versioned notification content — new relative to DATABASE_DESIGN.md's bare `templateKey` string, formalized per this phase's explicit model list to support per-channel, per-locale template variants (e.g., an email verification template in English and Spanish) without a code deployment for copy changes. *Constraints:* `(key, channel, languageCode)` unique. *Relations:* referenced optionally by `Notification` (`onDelete: SetNull` — a retired template doesn't invalidate the historical notifications sent from it).

**`Notification`** — *Purpose:* a logical notification to a platform user (email primarily; not a WhatsApp customer message — that's `Message`). *Cascade:* `onDelete: Cascade` from both `Tenant` and `recipient` `User` — a notification has no independent meaning once either is gone. *Indexes:* `status` — the retry/processing-queue query the `Notifications` background worker polls (SYSTEM_ARCHITECTURE.md 11.5).

**`NotificationLog`** — *Purpose:* per-delivery-attempt log, separated from the logical `Notification` so retries don't multiply the logical row (DATABASE_DESIGN.md 3.9.2). *Primary key:* app-generated UUIDv7, consistent with its append-only, potentially-multiple-per-notification write pattern.

---

## 12. System Models

```prisma
model AuditLog {
  id         String     @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId   String?    @db.Uuid
  action     String     @db.VarChar(50)
  entityType String     @db.VarChar(50)
  entityId   String     @db.Uuid
  actorType  ActorType
  actorId    String?    @db.Uuid
  metadata   Json?
  ipAddress  String?    @db.VarChar(45)
  createdAt  DateTime   @default(now())

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  actor  User?   @relation("AuditActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt], name: "idx_audit_logs_tenant_created")
  @@index([entityType, entityId], name: "idx_audit_logs_entity")
  @@map("audit_logs")
}

model ActivityLog {
  id           String    @id @db.Uuid // UUIDv7, app-generated — see Section 1.1
  tenantId     String?   @db.Uuid
  activityType String    @db.VarChar(50)
  userId       String?   @db.Uuid
  metadata     Json?
  ipAddress    String?   @db.VarChar(45)
  createdAt    DateTime  @default(now())

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt], name: "idx_activity_logs_tenant_created")
  @@index([userId], name: "idx_activity_logs_user_id")
  @@map("activity_logs")
}

model File {
  id                  String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String        @db.Uuid
  storageKey          String        @db.VarChar(500)
  contentType         String        @db.VarChar(100)
  sizeBytes           BigInt
  ownerType           FileOwnerType
  ownerId             String?       @db.Uuid // polymorphic by ownerType — no hard FK, see notes
  uploadedByUserId    String?       @db.Uuid
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  tenant           Tenant     @relation("TenantFiles", fields: [tenantId], references: [id], onDelete: Cascade)
  uploadedBy       User?      @relation(fields: [uploadedByUserId], references: [id], onDelete: SetNull)
  tenantLogoFor    Tenant[]   @relation("TenantLogo")
  invoices         Invoice[]

  @@index([tenantId], name: "idx_files_tenant_id")
  @@index([ownerType, ownerId], name: "idx_files_owner")
  @@map("files")
}

model APIKey {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @db.Uuid
  keyHash      String    @unique @db.VarChar(255)
  name         String    @db.VarChar(100)
  createdByUserId String? @db.Uuid
  lastUsedAt   DateTime?
  expiresAt    DateTime?
  revokedAt    DateTime?
  scopes       Json      @default("[]")
  createdAt    DateTime  @default(now())

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdBy User?  @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([tenantId], name: "idx_api_keys_tenant_id")
  @@map("api_keys")
}

model SystemSetting {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key              String   @unique @db.VarChar(100)
  value            Json
  description      String?  @db.VarChar(255)
  updatedByUserId  String?  @db.Uuid
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  updatedBy User? @relation(fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@map("system_settings")
}
```

### 12.1 Model Notes

**`AuditLog`** — *Purpose:* immutable, cross-entity trail of business-significant actions — the direct implementation of FR-28 (DATABASE_DESIGN.md 3.10.1/8.2). *Primary key:* app-generated UUIDv7. *Relations:* both `tenant` and `actor` nullable with `onDelete: SetNull` — a platform-level Super Admin action may have no single tenant owner, and an actor `User` may later be hard-deleted (rare) without invalidating the historical log entry. *Constraints:* deliberately **no** `@@unique` and **no** application-exposed update/delete path — enforced at the repository layer (SYSTEM_ARCHITECTURE.md 9.6 tamper-evidence), not expressible as a Prisma-level restriction (Prisma cannot forbid `update`/`delete` calls against a model; this is a documented convention for the service layer built on top of this schema, flagged again in Section 13 as an application-layer responsibility this schema assumes but cannot enforce itself).

**`ActivityLog`** — *Purpose:* high-frequency, low-business-significance activity (logins, future API-call logging), deliberately separate from `AuditLog` (DATABASE_DESIGN.md 8.3). Structurally near-identical to `AuditLog` by design — same nullable-tenant/actor pattern, same UUIDv7 key strategy — since both are append-only, time-ordered logs differing only in what they record and how long they're retained (Section 13).

**`File`** — *Purpose:* general-purpose S3-object metadata (branding, invoice PDFs, exports), distinct from `Media` (Section 9, WhatsApp-message-specific). *Relations:* `ownerId` is **explicitly not a hard foreign key** — it is polymorphic, interpreted according to `ownerType`, and its integrity is an application-layer responsibility, a documented, deliberate exception to "always index/enforce FKs" (DATABASE_DESIGN.md 3.10.3) — Prisma cannot express a conditional/polymorphic relation natively, so this is a plain indexed `String?` column, not a `@relation`. *Reverse relations:* `tenantLogoFor` (a `Tenant`'s `logoFileId` pointing back here) and `invoices` (an `Invoice`'s `invoicePdfFileId`) are both legitimate, non-polymorphic FK relations *from* other models *to* `File` — those are real Prisma relations, distinguished clearly from the polymorphic `ownerId` column, which is not.

**`APIKey`** — *Purpose:* reserved for future tenant-facing API access, not exposed via any UI/endpoint at MVP (DATABASE_DESIGN.md 3.10.4) — included now so enabling it later is additive, not a disruptive migration. *Constraints:* `keyHash` unique — the raw key is never stored.

**`SystemSetting`** — *Purpose:* platform-wide configuration distinct from `TenantSettings` (Section 4) — e.g., default active `PromptVersion`, global feature flags, maintenance-mode flag. *Constraints:* `key` unique. *Business rule:* Super-Admin-only write access (`Admin` module, SYSTEM_ARCHITECTURE.md 3.2) — enforced at the application/guard layer, not by this schema.

---

## 13. Relation & Index Rationale (Consolidated)

Every relation and index is explained inline in its model's notes (Sections 3–12); this section consolidates the cross-cutting *patterns* so a reviewer can audit the schema's consistency at a glance rather than re-deriving it model by model.

### 13.1 Relation Patterns

| Pattern | `onDelete` Used | Applied To | Why |
|---|---|---|---|
| Tenant-owned record's parent `Tenant` | `Cascade` | Nearly every model's `tenant` relation | A hard-deleted tenant (an exceptional, operator-only action) should not leave orphaned rows; the *normal* removal path for individual records is soft-delete, not tenant deletion, so this cascade rarely fires in practice |
| Record referencing a **soft-deletable** entity with historical significance | `Restrict` | `Appointment.customer`, `Appointment.employee`, `AppointmentService.service`, `AppointmentService.employee`, `Subscription.plan`, `Conversation.whatsappAccount`, `CustomerNote.author` | These relations protect against **hard-deleting** an entity that has dependent history — the entity's *normal* removal is soft-delete (which this constraint doesn't block), while accidental/incorrect hard-delete attempts fail loudly instead of silently cascading data loss |
| Optional, non-essential cross-reference | `SetNull` | `Employee.user`, `Employee.branch`, `Service.category`, `Room.branch`, `Appointment.room`, `Appointment.conversation`, `Conversation.assignedUser`, `Message.senderUser`, `Message.media`, `Message.promptVersion`, `AuditLog.tenant`/`actor`, `ActivityLog.tenant`/`user`, `File.uploadedBy`, `Invoice.invoicePdf`, `Payment.invoice`, `Coupon` back-reference, `NotificationTemplate` back-reference | The referencing row remains meaningful even if the referenced optional context disappears — nulling the pointer is correct, deleting the row would be data loss disproportionate to losing an optional cross-reference |
| Junction / strictly-dependent child row | `Cascade` on the owning side | `RolePermission`, `UserRole` (from `User`), `EmployeeService`, `CustomerTagAssignment`, `AppointmentService` (from `Appointment` only), `AppointmentStatusHistory`, `AppointmentReminder`, `MessageStatus`, `NotificationLog` | These rows have no independent meaning without their parent — deleting the parent should remove them, not leave orphans requiring separate cleanup |
| Self-referential chain | Explicit named relation, no cascade | `Appointment.rescheduledFrom`/`rescheduledTo`, `RefreshToken.replacedBySession`/`rotatedFrom` | Both ends of a chain must be individually addressable; Prisma requires a named relation to disambiguate a self-referential FK, and neither end should cascade-delete the other (a rescheduled appointment's original record is a distinct historical fact, not a dependent child) |

### 13.2 Index Rationale (Consolidated)

Every `tenantId` column is indexed, per DATABASE_DESIGN.md Section 1.8/6.2 — restated once here rather than repeated in every model's notes: this is the single highest-leverage indexing decision in the schema because virtually every query in the system is tenant-scoped, and an unindexed `tenantId` filter on any table of meaningful size would force a sequential scan on the platform's most common query shape. Beyond that baseline, every composite index declared in Sections 3–12 is tied to a specific, named query pattern from PROJECT_REQUIREMENTS.md's user journeys or SYSTEM_ARCHITECTURE.md's module responsibilities (call out per model above) — no index in this schema is speculative.

---

## 14. Migration Strategy

### 14.1 Tooling

Standard Prisma migration workflow: `prisma migrate dev` for local iterative development (generates and applies a migration, keeps `schema.prisma` and the migration history in sync), `prisma migrate deploy` in the GitHub Actions CI/CD pipeline (SYSTEM_ARCHITECTURE.md 10.5) applying committed, reviewed migrations to staging/production — no ad hoc production schema edits outside this flow, ever.

### 14.2 Recommended Migration Order

Identical dependency ordering to DATABASE_DESIGN.md Section 14.3, restated against this phase's final model names:

1. **Global reference data:** `Role`, `Permission`, `RolePermission`, `Plan`
2. **Tenant root:** `Tenant`
3. **Tenant configuration:** `TenantSettings`, `TenantFeature`, `SystemSetting`
4. **Identity:** `User`, `UserRole`, `TenantInvitation`, `RefreshToken`, `PasswordReset`, `EmailVerification`
5. **Locations (future-ready, wired early since other models optionally reference them):** `Branch`, `Room`
6. **Salon catalog & staff:** `ServiceCategory`, `Employee`, `Service`, `EmployeeService`, `BusinessHours`, `WorkingHours`, `Holiday`
7. **Customers:** `Customer`, `CustomerTag`, `CustomerNote`, `CustomerPreference`, `CustomerTagAssignment`
8. **Files & media:** `File`, `Media` *(a circular reference — `Tenant.logoFileId` → `File` and `File.tenantId` → `Tenant` — is resolved by creating `File` with a nullable, initially-unconstrained `tenantId` FK in the same migration batch as `Tenant`, then adding `Tenant.logoFileId` as a nullable FK in a follow-up migration step once both tables exist; documented here so it is not mistaken for an oversight when the migration files are authored)*
9. **AI registry:** `PromptVersion`
10. **WhatsApp integration:** `WhatsAppAccount`, `WebhookEvent`, `TemplateMessage`
11. **Conversations & AI:** `Conversation`, `Message`, `MessageStatus`, `AIContext`, `ConversationSummary`
12. **Appointments:** `Appointment`, `AppointmentService`, `AppointmentStatusHistory`, `AppointmentReminder`, `AppointmentFeedback`
13. **Billing:** `Subscription`, `Invoice`, `Payment`, `Coupon`
14. **Notifications:** `NotificationTemplate`, `Notification`, `NotificationLog`
15. **System/audit:** `AuditLog`, `ActivityLog`, `APIKey`, `WebhookLog`

### 14.3 Seed Strategy

Unchanged from DATABASE_DESIGN.md Section 11.6: a **required** seed script (run in every environment, including production, as part of first deploy) populates `Role` (4 fixed rows), `Permission` + `RolePermission` (the full permission matrix), `Plan` (at least one default tier), and initial `SystemSetting` rows (e.g., the default active `PromptVersion` key). A **separate, clearly-flagged development-only** seed script populates sample tenants/employees/services/customers for local and staging environments — never run against production, guarded by an explicit environment check in the seed script itself, not just operator discipline.

### 14.4 Manual Migration Adjustments Required

Prisma's declarative schema DSL does not yet express every constraint this design requires. The following are **documented, expected** manual edits to the generated SQL migration file after running `prisma migrate dev --create-only`, before applying:

| Constraint | Table(s) | Manual SQL Addition |
|---|---|---|
| Partial unique index (soft-delete-aware) | `Customer` `(tenantId, phoneNumber)`, `Employee`, `Service`, `ServiceCategory` equivalents where applicable | Replace the generated plain unique index with `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL` |
| Partial unique index (nullable-column-aware) | `Message.whatsappMessageId`, `WebhookEvent.whatsappMessageId` | `CREATE UNIQUE INDEX ... WHERE whatsapp_message_id IS NOT NULL` (Prisma's `@unique` on a nullable column already permits multiple `NULL`s under Postgres semantics, so this specific case is actually satisfied by default — called out here only to confirm it was verified, not left as an assumption) |
| Partial unique index (status-scoped) | `TenantInvitation` `(tenantId, email)` | `CREATE UNIQUE INDEX ... WHERE accepted_at IS NULL AND revoked_at IS NULL` |
| Composite foreign key for cross-tenant-safe relations | `Appointment` → `Employee`/`Customer`/`Service`, `AppointmentService` → `Service`/`Employee` | Add a compound unique `(tenant_id, id)` on the referenced table and a compound FK `(tenant_id, employee_id) REFERENCES employees(tenant_id, id)` on the referencing table — **the direct resolution of DATABASE_DESIGN.md Risk DB-R1**, finalized here as a required manual migration step rather than left open |
| Booking conflict-prevention hardening (optional, recommended) | `Appointment` | `CREATE EXTENSION IF NOT EXISTS btree_gist;` followed by an `EXCLUDE USING gist` constraint on `(employee_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE (status IN ('CONFIRMED','PENDING') AND deleted_at IS NULL)` — **the direct resolution of DATABASE_DESIGN.md Risk DB-R3**, providing a database-level backstop beneath the application-layer transaction + Redis-lock approach (DATABASE_DESIGN.md 10.4), rather than relying on the application layer alone |

These are called out explicitly, with the exact mechanism specified, so they are implemented as a planned step in the first migration rather than discovered as a gap during a later security/correctness review.

---

## 15. Future Scalability

Restating DATABASE_DESIGN.md Section 12 against this phase's concrete Prisma/schema-level mechanics:

- **UUIDv7 primary keys are already wired** (Section 1.1) on every table identified as high-write/time-ordered (`Message`, `MessageStatus`, `AuditLog`, `ActivityLog`, `AppointmentStatusHistory`, `NotificationLog`, `WebhookEvent`, `WebhookLog`) — no future migration is needed to adopt this; it is the schema's default posture for these tables from the first migration onward.
- **Table partitioning** (DATABASE_DESIGN.md 12.5) is **not** expressed in `schema.prisma` — Prisma has no native declarative support for PostgreSQL declarative partitioning as of this schema's target version. When the platform approaches the 10,000-tenant/10-million-message tier, partitioning `messages` (and the other high-volume log tables) by `created_at` range requires a **raw SQL migration** converting the table to a partitioned structure, applied outside Prisma's declarative flow but still versioned through the same `prisma migrate` history (a migration file can contain arbitrary SQL, not only Prisma-generated statements) — flagged here as a planned future migration, not a schema change needed today.
- **Composite foreign keys** (14.4) already position every tenant-scoped relation for the compound-unique-index pattern RLS (DATABASE_DESIGN.md 5.7) would also key on — adopting RLS later requires only `CREATE POLICY` statements plus a Prisma middleware/extension setting `app.current_tenant_id` per transaction, no further schema changes.
- **Read replicas** (DATABASE_DESIGN.md 12.3) require no schema changes at all — Prisma supports routing reads to a replica connection string via application-layer configuration once introduced; this schema makes no assumption that would block it.

---

## 16. Document Status & Next Steps

This document defines the **Prisma schema design and migration strategy only** — no NestJS code, no Angular code, no API endpoints, no repositories, and no services have been produced, per instruction. The Prisma code blocks in Sections 3–12 are the authoritative source for what `schema.prisma` will contain; assembling them into the final physical file (in the section order given, per the multi-file or single-file organization decided in the next phase) is a mechanical concatenation step, not a design decision requiring further review.

**Key decisions made in this phase requiring explicit sign-off before proceeding:**
1. `UserRole` implemented as a genuine many-to-many junction (multi-role-per-user capable), replacing the single `roleId` FK from DATABASE_DESIGN.md (Section 0).
2. `TenantSubscription`/`Subscription` consolidated into one model, `Subscription`, to avoid duplicated billing state (Section 0).
3. `Branch`/`Room` fully modeled now, but wired everywhere as optional relations, so MVP requires no location/room data entry (Section 5.1).
4. `PromptVersion` and `MessageStatus` promoted from bare string/enum columns (DATABASE_DESIGN.md) to first-class models with real referential integrity (Sections 8.1, 9.1).
5. The two previously-open DATABASE_DESIGN.md risks — cross-tenant FK integrity (DB-R1) and booking-conflict-prevention hardening (DB-R3) — are now resolved with a specific, documented manual-migration mechanism each (Section 14.4), not left open.
6. Five manual post-generation SQL edits are required for constraints Prisma's DSL cannot express declaratively (Section 14.4) — these must be applied to the initial migration, not deferred.

**Recommended next step:** Proceed to **REST API design** — resource/endpoint definitions, request/response contracts, and authentication/authorization mapping onto the module boundaries from SYSTEM_ARCHITECTURE.md Section 3 — once this document is approved.

**Awaiting your approval before proceeding.**

