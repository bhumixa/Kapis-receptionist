# DATABASE_DESIGN.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### Database Design Document — Single Source of Truth

**Document Status:** Draft for Approval
**Version:** 1.0
**Depends on:** PROJECT_REQUIREMENTS.md (v1.0), SYSTEM_ARCHITECTURE.md (v1.0)
**Scope:** Database design only. No Prisma schema file, no SQL DDL, no application code. These follow in the next phase pending approval of this document.

---

## 1. Database Design Philosophy

### 1.1 Why PostgreSQL

- **Transactional integrity for booking logic.** Appointment creation requires an atomic check-and-reserve (availability check + conflict prevention + creation) — a Critical NFR from PROJECT_REQUIREMENTS.md. PostgreSQL's MVCC and full ACID transaction support make this correctness guarantee straightforward; a document store or eventually-consistent database would require application-level compensation logic for the same guarantee.
- **Relational integrity across a genuinely relational domain.** Salons, employees, services, customers, appointments, and conversations form a dense web of foreign-key relationships (an appointment references a tenant, customer, employee, and one or more services). Enforcing this at the database layer, not only in application code, is a second line of defense against data corruption.
- **JSONB where flexibility is genuinely needed.** PostgreSQL's JSONB type gives semi-structured flexibility (AI context state, webhook payloads, audit metadata) without abandoning a relational core — avoiding the false choice between "fully relational" and "schemaless."
- **Row-Level Security as a future-compatible hardening layer.** PostgreSQL's native RLS (Section 5.7) gives a defense-in-depth path for multi-tenant isolation that doesn't require re-platforming later.
- **Operational fit with the fixed stack.** Runs cleanly in a single Docker container on the Hetzner VPS deployment target defined in SYSTEM_ARCHITECTURE.md, with mature backup/replication tooling appropriate for a self-managed deployment.

### 1.2 Why Prisma

- **Type-safe data access** shared across every backend module (SYSTEM_ARCHITECTURE.md Section 3), reducing an entire class of runtime errors (typo'd column names, mismatched types) that would otherwise surface in production.
- **Declarative schema as documentation.** The `schema.prisma` file (next phase) becomes a single, readable source of truth for the data model, consistent with this document's role as its design precursor.
- **Migration tooling** (`prisma migrate`) gives versioned, reviewable, reproducible schema changes — required for the CI/CD-gated deployment strategy defined in SYSTEM_ARCHITECTURE.md Section 10.5/10.11.
- **Constraint:** Prisma's relation and index modeling maps cleanly onto standard relational constructs (FKs, unique constraints, composite indexes) used throughout this design — nothing in this document assumes a capability Prisma lacks (e.g., this design avoids relying on native partitioning or RLS at the ORM layer for MVP, per 1.3/5.7, since Prisma's support for these is still limited and would otherwise force raw SQL escape hatches).

### 1.3 Multi-Tenant Strategy

**Shared database, shared schema, discriminator-column isolation** — every tenant-owned table carries a `tenant_id` column, and every query against a tenant-owned table is required to filter on it. This is the same decision recorded in SYSTEM_ARCHITECTURE.md Section 8.1, restated here as it directly shapes every table definition in this document. Full detail in Section 5.

### 1.4 Normalization Level

- The schema targets **Third Normal Form (3NF)** for transactional/operational tables (Tenant, Employee, Service, Customer, Appointment, Conversation, Message, Billing entities) — eliminating update anomalies for data that changes over the entity's lifetime (e.g., a customer's name, a service's price).
- **Deliberate, documented denormalization** is applied in two narrow cases:
  1. **Historical snapshots** — `AppointmentService` stores the service name/price/duration *as booked* (not just a foreign key to the live `Service` row), because a later price change to the service catalog must not rewrite history for already-completed appointments.
  2. **Read-optimized aggregates** — `ConversationSummary` stores a denormalized rollup of a conversation for fast dashboard/AI-context retrieval, avoiding an expensive re-aggregation of the full `Message` history on every AI turn (SYSTEM_ARCHITECTURE.md Section 5.7, token/latency optimization).
- Every denormalized field is explicitly flagged as such in Section 3 so it is never mistaken for a live, authoritative value.

### 1.5 UUID Strategy

- **All primary keys are UUIDs**, not auto-incrementing integers — required for a multi-tenant SaaS to avoid leaking row-count/growth information across tenants via sequential IDs, and to allow IDs to be safely generated client-side or in background workers without a round-trip.
- **Time-ordered UUIDs (UUIDv7) are used for high-write, high-volume tables** — `Message`, `AuditLog`, `ActivityLog`, `AppointmentHistory`, `NotificationLog`, `WebhookEvent`, `WhatsAppWebhookEvent` — generated at the application layer (Prisma `@default` cannot natively produce UUIDv7 in current PostgreSQL versions without an extension). This preserves B-tree index locality on the primary key for tables that are overwhelmingly insert-heavy and time-ordered by nature, avoiding the random-insert index fragmentation that standard UUIDv4 would cause at scale (directly relevant to Section 12's 10-million-message projection).
- **Standard UUIDv4 (`gen_random_uuid()` via the `pgcrypto` extension) is used for all other tables** — lower write volume, no meaningful ordering benefit, and simpler to generate at the database layer.
- All UUID columns are stored as native PostgreSQL `UUID` type (16 bytes), never as `VARCHAR`, for both storage efficiency and index performance.

### 1.6 Soft Deletes

- Tenant-owned entities that represent **business records with historical significance** (`Customer`, `Employee`, `Service`, `Appointment`, `Conversation`) use **soft deletes** via a nullable `deleted_at` timestamp — hard-deleting a customer or appointment would break referential history (e.g., an `AppointmentHistory` row referencing a deleted `Employee`) and violates the audit/traceability requirements in PROJECT_REQUIREMENTS.md Section 15/20.
- Purely ephemeral or derived tables (`UserSession`, `PasswordResetToken`, `WhatsAppWebhookEvent`, `NotificationLog`) use **hard deletes** (or time-based expiry/cleanup) since they carry no long-term business meaning once consumed or expired.
- Full mechanics in Section 7.

### 1.7 Auditing

- Every tenant-owned table carries `created_by` / `updated_by` (and, where soft-deletable, `deleted_by`) using an **actor-reference pattern** (`actor_type` + `actor_id`) rather than a plain user foreign key, because actions in this system are legitimately taken by four distinct actor types: a human `User`, the `AI` agent, the `SYSTEM` (background jobs, e.g., an auto-completed appointment), or in narrow cases the `CUSTOMER` themselves (e.g., cancelling via WhatsApp). This directly reflects the AI-as-first-class-actor design from SYSTEM_ARCHITECTURE.md Section 3.2 (`AI` module) and PROJECT_REQUIREMENTS.md Section 7 (AI Agent as a system actor).
- A dedicated `AuditLog` table captures **business-significant events** (booking created/changed/cancelled by AI or staff, settings changed, subscription changed) as an immutable, queryable trail — this is the FR-28 requirement.
- A dedicated `ActivityLog` table captures **lower-signal, higher-volume activity** (logins, page views if later needed, API calls) — kept separate from `AuditLog` so the business-critical trail is never diluted by high-frequency noise.
- Full mechanics in Section 8.

### 1.8 Indexing Strategy

- **Every tenant-owned table indexes `tenant_id`** (typically as the leading column of a composite index) — this is the single highest-leverage indexing decision in the schema, since virtually every query is tenant-scoped (SYSTEM_ARCHITECTURE.md Section 11.4).
- **Foreign keys are always indexed** (PostgreSQL does not do this automatically) since every FK is a routine join path.
- **Partial indexes** are used for soft-deleted tables (`WHERE deleted_at IS NULL`) to keep the common "active records" query path fast and small, and for unique constraints that must only apply to non-deleted rows (Section 7.3).
- **Composite indexes** are built around actual query patterns identified from the user journeys in PROJECT_REQUIREMENTS.md Section 14 (e.g., `(tenant_id, employee_id, start_time)` for availability/conflict checks; `(tenant_id, phone_number)` for inbound WhatsApp customer lookup).
- Full per-table detail in Section 6.

### 1.9 Timestamp Strategy

- All timestamp columns are `TIMESTAMPTZ` (timezone-aware, stored internally as UTC) — never naive `TIMESTAMP` — since salons operate across different timezones (`Tenant.timezone`) and the application must never ambiguously interpret a stored time.
- Every table has `created_at` (immutable, set once) and `updated_at` (updated on every write, either via Prisma's `@updatedAt` or a database trigger for tables written outside the ORM's normal update path).
- Display-layer timezone conversion (rendering a UTC timestamp in the salon's local time) is an application/frontend concern, not a database concern — the database is always the UTC source of truth.

### 1.10 Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Table names | `snake_case`, plural | `appointments`, `whatsapp_accounts` |
| Prisma model names | `PascalCase`, singular | `Appointment`, `WhatsAppAccount` |
| Column names | `snake_case` | `tenant_id`, `start_time`, `created_at` |
| Prisma field names | `camelCase` (mapped to `snake_case` via `@map`) | `tenantId`, `startTime`, `createdAt` |
| Primary key | Always `id` | — |
| Foreign key columns | `<referenced_singular>_id` | `employee_id`, `service_id` |
| Junction tables | `<entity_a>_<entity_b>` (both singular, alphabetically/logically ordered by dependency) | `employee_services`, `appointment_services` |
| Boolean columns | `is_` / `has_` prefix | `is_active`, `has_completed_onboarding` |
| Enum types | `PascalCase` type name, `SCREAMING_SNAKE_CASE` values | `AppointmentStatus.NO_SHOW` |
| Indexes | `idx_<table>_<columns>` | `idx_appointments_tenant_employee_start` |
| Unique constraints | `uq_<table>_<columns>` | `uq_customers_tenant_phone` |

### 1.11 Standard Column Sets (Reused Throughout Section 3)

To avoid repeating identical boilerplate on every table in Section 3, two standard field sets are defined once here and referenced by name.

**Standard Tenant-Owned Fields** (included in every tenant-scoped table unless explicitly noted otherwise):

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | UUID | No | generated (1.5) | Primary key |
| `tenant_id` | UUID | No | — | FK → `tenants.id`; enforces isolation (Section 5) |
| `created_at` | TIMESTAMPTZ | No | `now()` | Row creation time |
| `updated_at` | TIMESTAMPTZ | No | `now()`, auto-updated | Last modification time |
| `created_by_type` | ActorType enum | No | `'USER'` | Who created this row (1.7) |
| `created_by_id` | UUID | Yes | `null` | FK → `users.id` when `created_by_type = 'USER'`, else `null` |
| `updated_by_type` | ActorType enum | No | `'USER'` | Who last modified this row |
| `updated_by_id` | UUID | Yes | `null` | FK → `users.id` when applicable |

**Standard Soft-Delete Fields** (added to the above for tables identified in 1.6 as soft-deletable):

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `deleted_at` | TIMESTAMPTZ | Yes | `null` | Soft-delete marker; `null` = active |
| `deleted_by_type` | ActorType enum | Yes | `null` | Who deleted this row |
| `deleted_by_id` | UUID | Yes | `null` | FK → `users.id` when applicable |

**`ActorType` enum:** `USER`, `AI`, `SYSTEM`, `CUSTOMER` — used across the actor-reference pattern platform-wide.

In Section 3, each table lists **only its entity-specific columns**; unless stated otherwise, assume `+ Standard Tenant-Owned Fields` and, where relevant, `+ Standard Soft-Delete Fields` are also present.

---

## 2. Entity Relationship Overview

Entities grouped by domain, matching SYSTEM_ARCHITECTURE.md's module boundaries (Section 3). A short designation follows each: **[Tenant-Owned]**, **[Global/Shared]**, or **[Junction]**.

### Authentication & Access
- `User` **[Tenant-Owned, nullable tenant for Super Admin]**
- `Role` **[Global]**
- `Permission` **[Global]**
- `RolePermission` **[Global, Junction]**
- `UserSession` **[Tenant-Owned]**
- `PasswordResetToken` **[Tenant-Owned]**
- `EmailVerificationToken` **[Tenant-Owned]**

### Tenant
- `Tenant` **[Root entity]**
- `TenantSettings` **[Tenant-Owned, 1:1]**
- `TenantInvitation` **[Tenant-Owned]**
- *(`Subscription` belongs here conceptually but is fully specified once, under Billing, to avoid duplication — see 2.7)*

### Salon (Staff & Catalog)
- `Employee` **[Tenant-Owned]**
- `Service` **[Tenant-Owned]**
- `Category` **[Tenant-Owned]**
- `EmployeeService` **[Tenant-Owned, Junction]**
- `WorkingHours` **[Tenant-Owned]**
- `Holiday` **[Tenant-Owned]**
- `EmployeeAvailability` **[Tenant-Owned]** *(date-specific overrides/exceptions)*

### Customer
- `Customer` **[Tenant-Owned]**
- `CustomerNote` **[Tenant-Owned]**
- `CustomerTag` **[Tenant-Owned]**
- `CustomerTagAssignment` **[Tenant-Owned, Junction]**

### Appointments
- `Appointment` **[Tenant-Owned]**
- `AppointmentService` **[Tenant-Owned, Junction + Snapshot]**
- `AppointmentHistory` **[Tenant-Owned, Append-Only]**

### Conversations
- `Conversation` **[Tenant-Owned]**
- `Message` **[Tenant-Owned, High-Volume]**
- `AIContext` **[Tenant-Owned, 1:1 with Conversation]**
- `ConversationSummary` **[Tenant-Owned, Denormalized]**

### WhatsApp
- `WhatsAppAccount` **[Tenant-Owned, 1:1 with Tenant]**
- `WhatsAppWebhookEvent` **[Global ingestion, tenant resolved async]**
- `TemplateMessage` **[Tenant-Owned]**
- `Media` **[Tenant-Owned]**

### Billing
- `Plan` **[Global]**
- `Subscription` **[Tenant-Owned, 1:1 with Tenant]**
- `Invoice` **[Tenant-Owned]**
- `Payment` **[Tenant-Owned]**
- `Coupon` **[Global]**

### Notifications
- `Notification` **[Tenant-Owned]**
- `NotificationLog` **[Tenant-Owned, High-Volume]**

### System
- `AuditLog` **[Tenant-Owned, nullable tenant for platform-level events]**
- `ActivityLog` **[Tenant-Owned, High-Volume]**
- `File` **[Tenant-Owned]**
- `APIKey` **[Tenant-Owned]**
- `WebhookEvent` **[Global ingestion — e.g. Stripe]**
- `Setting` **[Global — platform-level configuration]**

**Total: 45 tables** (Section 14.1 gives the flat list).

---

## 3. Table-by-Table Design

> Each table lists entity-specific columns only. `+ Standard Tenant-Owned Fields` and `+ Standard Soft-Delete Fields` refer to Section 1.11 and are not repeated in full below.

### 3.1 Authentication & Access

#### 3.1.1 `users`
**Purpose:** Platform login identity for Owners, Managers, Staff, and Super Admins.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `email` | VARCHAR(255) | No | — | Login identifier |
| `password_hash` | VARCHAR(255) | Yes | `null` | Null if user only authenticates via Google OAuth |
| `first_name` | VARCHAR(100) | No | — | |
| `last_name` | VARCHAR(100) | No | — | |
| `role_id` | UUID | No | — | FK → `roles.id` |
| `google_id` | VARCHAR(255) | Yes | `null` | Google OAuth subject identifier |
| `is_email_verified` | BOOLEAN | No | `false` | |
| `is_active` | BOOLEAN | No | `true` | Deactivated by Owner/Admin without deleting the record |
| `last_login_at` | TIMESTAMPTZ | Yes | `null` | |
| `two_factor_enabled` | BOOLEAN | No | `false` | Reserved per SYSTEM_ARCHITECTURE.md 7.8 (2FA-ready) |
| `two_factor_secret` | VARCHAR(255) | Yes | `null` | Encrypted at application layer if set |

+ Standard Tenant-Owned Fields (`tenant_id` **nullable** — `null` only for `SUPER_ADMIN` role) + Standard Soft-Delete Fields.
**Primary Key:** `id`
**Foreign Keys:** `tenant_id` → `tenants.id` (nullable); `role_id` → `roles.id`
**Unique Constraints:** `uq_users_email` on `email` (global uniqueness — one login identity platform-wide); `uq_users_google_id` on `google_id` (partial, `WHERE google_id IS NOT NULL`)
**Indexes:** `idx_users_tenant_id`; `idx_users_role_id`
**Relationships:** belongs to one `Tenant` (nullable) and one `Role`; has many `UserSession`, `PasswordResetToken`, `EmailVerificationToken`
**Business Rules:** A non-Super-Admin user must have a non-null `tenant_id`. Email is globally unique across the entire platform (not per-tenant) — a person cannot use the same email for two different salon accounts under current design; this is a deliberate simplicity choice flagged for revisit if multi-tenant membership per email is later required.
**Expected Row Growth:** Low-moderate — bounded by staff headcount per tenant (typically 1–20); at 10,000 tenants, roughly 20,000–100,000 rows.
**Frequently Queried Columns:** `email` (login), `tenant_id` (staff listing), `google_id` (OAuth callback).

---

#### 3.1.2 `roles`
**Purpose:** Fixed, platform-defined roles (`SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF`) — seeded, not created by tenants (SYSTEM_ARCHITECTURE.md 7.3).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | UUID | No | generated | |
| `name` | VARCHAR(50) | No | — | e.g. `OWNER` |
| `description` | VARCHAR(255) | Yes | `null` | |
| `created_at` / `updated_at` | TIMESTAMPTZ | No | `now()` | |

**Primary Key:** `id`. **Foreign Keys:** none. **Unique Constraints:** `uq_roles_name`. **Indexes:** none beyond PK (tiny, seeded table — always fits in cache).
**Relationships:** has many `User`; has many `Permission` via `RolePermission`.
**Business Rules:** Not tenant-scoped — global/shared. Not exposed for tenant self-service creation at MVP (extension point noted in SYSTEM_ARCHITECTURE.md 7.4 for future custom roles).
**Expected Row Growth:** Static — 4 rows at launch.
**Frequently Queried Columns:** `name` (rarely queried directly; usually joined via `role_id`).

---

#### 3.1.3 `permissions`
**Purpose:** Named, fine-grained permissions (e.g., `billing:manage`, `account:delete`, `staff:invite`) referenced by the guard layer (SYSTEM_ARCHITECTURE.md 7.4).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | UUID | No | generated | |
| `key` | VARCHAR(100) | No | — | e.g. `billing:manage` |
| `description` | VARCHAR(255) | Yes | `null` | |
| `created_at` | TIMESTAMPTZ | No | `now()` | |

**Primary Key:** `id`. **Unique Constraints:** `uq_permissions_key`. **Indexes:** none beyond PK.
**Relationships:** many-to-many with `Role` via `RolePermission`.
**Business Rules:** Global, seeded, versioned alongside application code (a new permission ships with a migration + seed update).
**Expected Row Growth:** Static — dozens of rows, grows slowly as features add new permission checks.
**Frequently Queried Columns:** `key`.

---

#### 3.1.4 `role_permissions` *(Junction)*
**Purpose:** Many-to-many mapping between `Role` and `Permission`.
**Columns:** `id` UUID PK; `role_id` UUID; `permission_id` UUID; `created_at` TIMESTAMPTZ.
**Primary Key:** `id` (surrogate; alternative would be a composite PK on `(role_id, permission_id)` — surrogate chosen for Prisma relation-model consistency across the schema).
**Foreign Keys:** `role_id` → `roles.id`; `permission_id` → `permissions.id`.
**Unique Constraints:** `uq_role_permissions_role_permission` on `(role_id, permission_id)`.
**Indexes:** `idx_role_permissions_role_id`; `idx_role_permissions_permission_id`.
**Relationships:** junction between `Role` and `Permission`.
**Business Rules:** Seeded alongside `Role`/`Permission`; not user-editable at MVP.
**Expected Row Growth:** Static — small (roles × applicable permissions).
**Frequently Queried Columns:** `role_id` (permission-check hot path, cached in Redis per SYSTEM_ARCHITECTURE.md, not queried on every request).

---

#### 3.1.5 `user_sessions`
**Purpose:** Tracks issued refresh-token sessions to support rotation, reuse detection, and server-side revocation (SYSTEM_ARCHITECTURE.md 7.2).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `user_id` | UUID | No | — | FK → `users.id` |
| `refresh_token_hash` | VARCHAR(255) | No | — | Hashed, never the raw token |
| `user_agent` | VARCHAR(255) | Yes | `null` | |
| `ip_address` | VARCHAR(45) | Yes | `null` | IPv4/IPv6 |
| `expires_at` | TIMESTAMPTZ | No | — | |
| `revoked_at` | TIMESTAMPTZ | Yes | `null` | Set on logout or reuse-detection |
| `replaced_by_session_id` | UUID | Yes | `null` | Self-referential — tracks rotation chain |

+ Standard Tenant-Owned Fields (`tenant_id` mirrors the user's tenant for direct scoping; nullable for Super Admin sessions).
**Primary Key:** `id`. **Foreign Keys:** `user_id` → `users.id`; `replaced_by_session_id` → `user_sessions.id` (self-referential, nullable).
**Unique Constraints:** `uq_user_sessions_refresh_token_hash`.
**Indexes:** `idx_user_sessions_user_id`; `idx_user_sessions_expires_at` (for cleanup jobs).
**Relationships:** belongs to one `User`.
**Business Rules:** A revoked or expired session's refresh token must never validate again. Reuse of an already-rotated token triggers revocation of the entire chain (security response to token theft).
**Expected Row Growth:** Moderate-high — one row per login/refresh cycle; pruned by a scheduled cleanup job for expired/revoked rows older than a retention window.
**Frequently Queried Columns:** `refresh_token_hash` (every refresh call), `user_id`.

---

#### 3.1.6 `password_reset_tokens`
**Purpose:** Single-use, time-limited tokens for the password reset flow (SYSTEM_ARCHITECTURE.md 7.6).
**Columns:** `user_id` UUID; `token_hash` VARCHAR(255); `expires_at` TIMESTAMPTZ; `used_at` TIMESTAMPTZ (nullable).
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `user_id` → `users.id`.
**Unique Constraints:** `uq_password_reset_tokens_token_hash`.
**Indexes:** `idx_password_reset_tokens_user_id`; `idx_password_reset_tokens_expires_at`.
**Business Rules:** A token is invalid if `used_at IS NOT NULL` or `expires_at < now()`. Requesting a new reset token does not necessarily invalidate prior unexpired ones at the schema level — that policy is application logic.
**Expected Row Growth:** Low — one row per reset request; short retention, periodically purged.
**Frequently Queried Columns:** `token_hash`.

---

#### 3.1.7 `email_verification_tokens`
**Purpose:** Single-use tokens for email verification on sign-up/invite (SYSTEM_ARCHITECTURE.md 7.7).
**Columns:** `user_id` UUID; `token_hash` VARCHAR(255); `expires_at` TIMESTAMPTZ; `verified_at` TIMESTAMPTZ (nullable).
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `user_id` → `users.id`.
**Unique Constraints:** `uq_email_verification_tokens_token_hash`.
**Indexes:** `idx_email_verification_tokens_user_id`.
**Business Rules:** Mirrors `password_reset_tokens` mechanics.
**Expected Row Growth:** Low — one to a few rows per new user.
**Frequently Queried Columns:** `token_hash`.

---

### 3.2 Tenant

#### 3.2.1 `tenants`
**Purpose:** The root entity of multi-tenancy — one row per salon business.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | UUID | No | generated | |
| `name` | VARCHAR(255) | No | — | Salon business name |
| `slug` | VARCHAR(100) | No | — | URL-safe identifier |
| `status` | TenantStatus enum | No | `'TRIAL'` | `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED` |
| `timezone` | VARCHAR(50) | No | `'UTC'` | IANA timezone name, e.g. `America/Sao_Paulo` |
| `address_line1` | VARCHAR(255) | Yes | `null` | |
| `address_line2` | VARCHAR(255) | Yes | `null` | |
| `city` | VARCHAR(100) | Yes | `null` | |
| `country_code` | CHAR(2) | Yes | `null` | ISO 3166-1 alpha-2 |
| `default_locale` | VARCHAR(10) | No | `'en'` | Drives AI/UI language default |
| `logo_file_id` | UUID | Yes | `null` | FK → `files.id` |
| `trial_ends_at` | TIMESTAMPTZ | Yes | `null` | |
| `suspended_at` | TIMESTAMPTZ | Yes | `null` | |
| `created_at` / `updated_at` | TIMESTAMPTZ | No | `now()` | (no `tenant_id` — this table *is* the tenant root) |
| `deleted_at` | TIMESTAMPTZ | Yes | `null` | Soft-delete for account closure |

**Primary Key:** `id`. **Foreign Keys:** `logo_file_id` → `files.id` (nullable).
**Unique Constraints:** `uq_tenants_slug`.
**Indexes:** `idx_tenants_status` (Admin dashboard filtering); `idx_tenants_slug`.
**Relationships:** root of nearly every tenant-owned table in this document (one-to-many in every case).
**Business Rules:** `status` transitions follow the subscription lifecycle (Section 9.4); a `SUSPENDED` tenant's `WhatsAppAccount` stops actively processing new AI conversations per PROJECT_REQUIREMENTS.md Business Rule 10.
**Expected Row Growth:** Direct proxy for business growth — 100 at early traction, 10,000+ at scale (Section 12).
**Frequently Queried Columns:** `id` (join target from every tenant-owned table), `status`, `slug`.

---

#### 3.2.2 `tenant_settings`
**Purpose:** One-to-one configuration record per tenant — AI behavior configuration, cancellation policy, notification preferences (SYSTEM_ARCHITECTURE.md `Settings` module).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `tenant_id` | UUID | No | — | FK → `tenants.id`, also unique (1:1) |
| `ai_greeting_message` | TEXT | Yes | `null` | |
| `ai_tone` | VARCHAR(50) | No | `'friendly'` | |
| `ai_escalation_instructions` | TEXT | Yes | `null` | Free-text guidance injected into the AI system prompt (SYSTEM_ARCHITECTURE.md 5.1) |
| `cancellation_notice_hours` | INTEGER | No | `24` | Minimum notice required to cancel/reschedule |
| `booking_buffer_minutes` | INTEGER | No | `0` | Buffer time between appointments |
| `reminder_hours_before` | INTEGER | No | `24` | When the automated reminder fires |
| `ai_disclosure_enabled` | BOOLEAN | No | `true` | Whether the AI discloses it is an AI (PROJECT_REQUIREMENTS.md Section 22, Q5) |
| `notification_preferences` | JSONB | No | `'{}'` | Flexible per-channel opt-in flags |

+ `created_at` / `updated_at` (no separate soft delete — deleted alongside tenant).
**Primary Key:** `id` (surrogate, despite 1:1 — keeps consistency with the rest of the schema and Prisma relation conventions). **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_tenant_settings_tenant_id` (enforces the 1:1 relationship).
**Indexes:** covered by the unique constraint.
**Relationships:** one-to-one with `Tenant`.
**Business Rules:** Created automatically at tenant creation (never null for an active tenant). `notification_preferences` is JSONB specifically because its shape is expected to evolve (new channels) without a migration.
**Expected Row Growth:** Exactly one row per tenant.
**Frequently Queried Columns:** `tenant_id` — read on nearly every AI turn (cached in Redis per SYSTEM_ARCHITECTURE.md 11.2).

---

#### 3.2.3 `tenant_invitations`
**Purpose:** Tracks pending staff invitations before the invitee creates a `User` account (FR-4).
**Columns:** `email` VARCHAR(255); `role_id` UUID; `invited_by_user_id` UUID; `token_hash` VARCHAR(255); `expires_at` TIMESTAMPTZ; `accepted_at` TIMESTAMPTZ (nullable); `revoked_at` TIMESTAMPTZ (nullable).
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `role_id` → `roles.id`; `invited_by_user_id` → `users.id`.
**Unique Constraints:** `uq_tenant_invitations_token_hash`; partial unique `uq_tenant_invitations_tenant_email_pending` on `(tenant_id, email)` `WHERE accepted_at IS NULL AND revoked_at IS NULL` (prevents duplicate pending invites to the same email).
**Indexes:** `idx_tenant_invitations_tenant_id`; `idx_tenant_invitations_email`.
**Relationships:** belongs to `Tenant`; references `Role` and inviting `User`.
**Business Rules:** On acceptance, a `User` row is created linking `tenant_id` and `role_id` from the invitation.
**Expected Row Growth:** Low — proportional to staff turnover.
**Frequently Queried Columns:** `token_hash`, `(tenant_id, email)`.

---

#### 3.2.4 `salon_profiles` *(Added, Milestone 4 — docs/adr/ADR-007-salon-management.md)*
**Purpose:** One-to-one satellite record per tenant holding the business-facing profile fields Milestone 4 introduces — `Tenant` itself already owns the core identity fields (`name`/`timezone`/`address*`/`default_locale`), so this table holds only what's genuinely new (mirrors `tenant_settings`' own 1:1-satellite-table precedent).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `tenant_id` | UUID | No | — | FK → `tenants.id`, also unique (1:1) |
| `description` | VARCHAR(1000) | Yes | `null` | |
| `contact_email` | VARCHAR(255) | Yes | `null` | |
| `contact_phone` | VARCHAR(20) | Yes | `null` | E.164 |
| `website` | VARCHAR(255) | Yes | `null` | |
| `currency` | CHAR(3) | No | `'USD'` | ISO 4217 |
| `logo_url` | VARCHAR(500) | Yes | `null` | Placeholder string — no `Files`/S3 module exists yet; deliberately not `tenants.logo_file_id` (reserved for a future real upload) |
| `primary_color` | VARCHAR(7) | Yes | `null` | Hex, e.g. `#4A90D9` |
| `secondary_color` | VARCHAR(7) | Yes | `null` | |

+ `created_at` / `updated_at` (no separate soft delete — deleted alongside tenant, `onDelete: Cascade`).
**Primary Key:** `id` (surrogate, despite 1:1 — same convention as `tenant_settings`). **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_salon_profiles_tenant_id` (enforces the 1:1 relationship — Prisma's `@unique` on `tenantId`).
**Indexes:** covered by the unique constraint.
**Relationships:** one-to-one with `Tenant`.
**Business Rules:** auto-created on first `GET /salon` if absent (`upsert`), same backfill convention as `tenant_settings`. `Tenant.timezone`/`default_locale`/`name`/`address*` are never duplicated here — always read/written through `modules/tenants`' own repository (docs/SALON_ARCHITECTURE.md Section 3).
**Expected Row Growth:** Exactly one row per tenant (once backfilled).
**Frequently Queried Columns:** `tenant_id`.

---

### 3.3 Salon (Staff & Catalog)

**Milestone 4 note (docs/adr/ADR-007-salon-management.md):** the two tables below (`business_hours`, `holidays`) were built in Milestone 4 as scoped-down subsets of this section's fuller design — no `employee_id` column exists yet on either (Employees don't exist until the renumbered Milestone 5), so both are tenant-wide only for now. Field names/shapes match this section's design exactly, so that future milestone's migration only *adds* columns. See each table's own "Amended, Milestone 4" note below, and docs/SALON_ARCHITECTURE.md for the as-built reference.

#### 3.3.1 `employees`
**Purpose:** A schedulable staff resource — distinct from `User` (login access); an `Employee` may optionally link to a `User`.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `user_id` | UUID | Yes | `null` | FK → `users.id`; null if the staff member has no login |
| `first_name` | VARCHAR(100) | No | — | |
| `last_name` | VARCHAR(100) | No | — | |
| `phone_number` | VARCHAR(20) | Yes | `null` | E.164 |
| `status` | EmployeeStatus enum | No | `'ACTIVE'` | `ACTIVE`, `ON_LEAVE`, `INACTIVE` |
| `color_tag` | VARCHAR(7) | Yes | `null` | Hex color for calendar UI |
| `bio` | TEXT | Yes | `null` | Optional, may be used in AI recommendation copy |

+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `user_id` → `users.id` (nullable).
**Unique Constraints:** none beyond PK (two employees may share a name).
**Indexes:** `idx_employees_tenant_id`; `idx_employees_tenant_status` composite `(tenant_id, status)` (availability queries only consider `ACTIVE` staff); partial `WHERE deleted_at IS NULL`.
**Relationships:** belongs to `Tenant`; optionally linked to `User`; many-to-many with `Service` via `EmployeeService`; has many `WorkingHours`, `EmployeeAvailability`, `Appointment`.
**Business Rules:** An `Employee` with `status != 'ACTIVE'` is excluded from availability computation (SYSTEM_ARCHITECTURE.md `Availability` module).
**Expected Row Growth:** Low per tenant (1–20 typical) — at 10,000 tenants, roughly 50,000–200,000 rows total.
**Frequently Queried Columns:** `(tenant_id, status)`.

---

#### 3.3.2 `categories`
**Purpose:** Groups services for organization/display (e.g., "Hair," "Nails," "Spa").
**Columns:** `name` VARCHAR(100); `display_order` INTEGER default `0`.
+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** partial `uq_categories_tenant_name` on `(tenant_id, name)` `WHERE deleted_at IS NULL`.
**Indexes:** `idx_categories_tenant_id`.
**Relationships:** has many `Service`.
**Business Rules:** Optional grouping — a `Service` may have a `null` category.
**Expected Row Growth:** Very low — a handful per tenant.
**Frequently Queried Columns:** `tenant_id`.

---

#### 3.3.3 `services`
**Purpose:** The salon's bookable service catalog — the structured data the AI relies on for booking and recommendations (FR-5, FR-12).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `category_id` | UUID | Yes | `null` | FK → `categories.id` |
| `name` | VARCHAR(150) | No | — | |
| `description` | TEXT | Yes | `null` | Consumed by AI for recommendation (FR-12) |
| `duration_minutes` | INTEGER | No | — | Drives availability slot computation |
| `price_cents` | INTEGER | No | — | Minor units (avoids float rounding) |
| `currency` | CHAR(3) | No | `'USD'` | ISO 4217 |
| `is_active` | BOOLEAN | No | `true` | Inactive services excluded from AI/booking |
| `display_order` | INTEGER | No | `0` | |

+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `category_id` → `categories.id` (nullable).
**Unique Constraints:** none (two services may share a name, e.g. across categories).
**Indexes:** `idx_services_tenant_id`; `idx_services_tenant_active` composite `(tenant_id, is_active)`; partial `WHERE deleted_at IS NULL`.
**Relationships:** belongs to `Tenant`, optional `Category`; many-to-many with `Employee` via `EmployeeService`; referenced by `AppointmentService`.
**Business Rules:** `duration_minutes` and `price_cents` must be positive; changing these values does not retroactively alter already-booked `AppointmentService` snapshot rows (1.4).
**Expected Row Growth:** Low per tenant (typically 5–50) — at 10,000 tenants, ~100,000–500,000 rows.
**Frequently Queried Columns:** `(tenant_id, is_active)`, `id` (heavy join target from `EmployeeService`/`AppointmentService`).

---

#### 3.3.4 `employee_services` *(Junction)*
**Purpose:** Which employees are eligible to perform which services — the skill-matching data the `Availability` module needs.
**Columns:** `employee_id` UUID; `service_id` UUID.
+ Standard Tenant-Owned Fields (denormalized `tenant_id` for direct scoping without a join, consistent with 1.11).
**Primary Key:** `id`. **Foreign Keys:** `employee_id` → `employees.id`; `service_id` → `services.id`.
**Unique Constraints:** `uq_employee_services_employee_service` on `(employee_id, service_id)`.
**Indexes:** `idx_employee_services_employee_id`; `idx_employee_services_service_id`; `idx_employee_services_tenant_id`.
**Relationships:** junction between `Employee` and `Service`.
**Business Rules:** A service with zero eligible employees cannot be booked — the AI/UI should surface this as a configuration warning (application-layer concern).
**Expected Row Growth:** Moderate — roughly (employees × avg services per employee) per tenant.
**Frequently Queried Columns:** `employee_id` (availability computation), `service_id`.

---

#### 3.3.4a `business_hours` *(Added, Milestone 4 — docs/adr/ADR-007-salon-management.md)*
**Purpose:** The salon's recurring weekly opening hours — distinct from per-employee `working_hours` below (a salon can be open while a given employee isn't scheduled, and vice versa).
**Columns:** `day_of_week` SMALLINT (0=Sunday..6=Saturday); `start_time` TIME; `end_time` TIME; `is_closed` BOOLEAN default `false`.
+ Standard Tenant-Owned Fields (no `employee_id`/`branch_id` yet — see the Milestone 4 note above §3.3).
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id` (`onDelete: Cascade`).
**Unique Constraints:** `uq_business_hours_tenant_day` on `(tenant_id, day_of_week)`.
**Indexes:** covered by the unique constraint.
**Relationships:** belongs to `Tenant`.
**Business Rules:** `end_time` must be after `start_time` unless `is_closed`, and exactly 7 rows (one per `day_of_week`, 0–6) must exist after any `PUT /salon/business-hours` — enforced at the application layer (`BusinessHoursService`), not a DB constraint. A closed day still stores a `'00:00'`/`'00:00'` placeholder (`start_time`/`end_time` are `NOT NULL`) — clients must key off `is_closed`, never assume null times. Wall-clock storage only; timezone interpretation is `tenants.timezone`, read separately.
**Expected Row Growth:** Exactly 7 rows per tenant (once backfilled via the first `PUT`).
**Frequently Queried Columns:** `(tenant_id, day_of_week)`.

---

#### 3.3.5 `working_hours`
**Purpose:** Recurring weekly schedule template per employee (e.g., "Tuesdays 9am–5pm").
**Columns:** `employee_id` UUID; `day_of_week` SMALLINT (0=Sunday..6=Saturday); `start_time` TIME; `end_time` TIME; `is_active` BOOLEAN default `true`.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `employee_id` → `employees.id`.
**Unique Constraints:** none (an employee may have split shifts on the same day — multiple rows per `day_of_week` are valid).
**Indexes:** `idx_working_hours_employee_day` composite `(employee_id, day_of_week)`.
**Relationships:** belongs to `Employee`.
**Business Rules:** `end_time` must be after `start_time` within a single row (overnight shifts are out of scope for MVP, consistent with typical salon hours).
**Expected Row Growth:** Low — bounded by (employees × days × shifts per day).
**Frequently Queried Columns:** `(employee_id, day_of_week)` — read on every availability computation.

---

#### 3.3.6 `holidays`
**Purpose:** Salon-wide or employee-specific closure dates (e.g., public holidays, planned closures).
**Columns:** `employee_id` UUID (nullable — `null` means tenant-wide closure); `date` DATE; `reason` VARCHAR(255) nullable.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `employee_id` → `employees.id` (nullable).
**Unique Constraints:** partial `uq_holidays_tenant_date_employee` on `(tenant_id, date, employee_id)`.
**Indexes:** `idx_holidays_tenant_date` composite `(tenant_id, date)`.
**Relationships:** belongs to `Tenant`, optionally `Employee`.
**Business Rules:** A tenant-wide holiday (`employee_id IS NULL`) blocks availability for all employees on that date; an employee-specific holiday blocks only that employee.
**Expected Row Growth:** Low-moderate — a handful of tenant-wide holidays per year plus occasional per-employee entries.
**Frequently Queried Columns:** `(tenant_id, date)`.
**Amended, Milestone 4 (docs/adr/ADR-007-salon-management.md) — as-built is a scoped-down subset:** no `employee_id` column exists yet (tenant-wide only), `reason` is **required** (not nullable — a salon-wide calendar entry always needs a display label), and the unique constraint actually built is a plain `uq_holidays_tenant_date` on `(tenant_id, date)` — correct and sufficient with no `employee_id` column at all. **Forward note for whichever milestone adds `employee_id`:** switching straight to a naive 3-column `@@unique([tenant_id, date, employee_id])` would silently stop preventing duplicate tenant-wide holidays, since Postgres treats every `NULL` as distinct in an ordinary unique index — that migration must add the partial index this section already specifies (`uq_holidays_tenant_date_employee ... WHERE employee_id IS NULL`) via manual migration SQL (PRISMA_SCHEMA.md Section 14.4's mechanism), not rely on Prisma's declarative `@@unique` alone.

---

#### 3.3.7 `employee_availability` *(date-specific overrides)*
**Purpose:** One-off exceptions to the recurring `WorkingHours` template — e.g., "available extra hours this Saturday" or "leaving early on the 14th" — distinct from full-day `Holiday` closures.
**Columns:** `employee_id` UUID; `date` DATE; `start_time` TIME; `end_time` TIME; `type` VARCHAR(20) (`EXTRA` or `REDUCED`).
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `employee_id` → `employees.id`.
**Unique Constraints:** none (multiple override windows possible per date).
**Indexes:** `idx_employee_availability_employee_date` composite `(employee_id, date)`.
**Relationships:** belongs to `Employee`.
**Business Rules:** Overrides take precedence over `WorkingHours` for the given date in availability computation.
**Expected Row Growth:** Low — occasional, ad hoc entries.
**Frequently Queried Columns:** `(employee_id, date)`.

---

### 3.4 Customer

#### 3.4.1 `customers`
**Purpose:** A salon's end customer — the person booking via WhatsApp, scoped per tenant (a phone number is a distinct customer identity in each salon it messages).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `phone_number` | VARCHAR(20) | No | — | E.164, the WhatsApp identity |
| `first_name` | VARCHAR(100) | Yes | `null` | May be unknown initially, filled in by AI/staff |
| `last_name` | VARCHAR(100) | Yes | `null` | |
| `email` | VARCHAR(255) | Yes | `null` | Optional, e.g. for invoice/receipt |
| `preferred_language` | VARCHAR(10) | Yes | `null` | |
| `preferred_employee_id` | UUID | Yes | `null` | FK → `employees.id` |
| `marketing_opt_in` | BOOLEAN | No | `false` | Consent flag (compliance, PROJECT_REQUIREMENTS.md Section 20) |

+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `preferred_employee_id` → `employees.id` (nullable).
**Unique Constraints:** partial `uq_customers_tenant_phone` on `(tenant_id, phone_number)` `WHERE deleted_at IS NULL` — a phone number is unique **within a tenant**, not globally (the same person may message two different salons).
**Indexes:** `idx_customers_tenant_phone` (covered by the unique constraint, also the primary lookup path on every inbound WhatsApp message); `idx_customers_tenant_id`.
**Relationships:** belongs to `Tenant`; has many `Appointment`, `Conversation`, `CustomerNote`; many-to-many with `CustomerTag`.
**Business Rules:** `findOrCreateByPhone` (SYSTEM_ARCHITECTURE.md `Customers` module) is the canonical creation path — a new inbound WhatsApp message from an unrecognized number creates this row automatically.
**Expected Row Growth:** The largest catalog-type table by tenant — potentially hundreds to thousands per active salon; at 10,000 tenants, millions of rows total.
**Frequently Queried Columns:** `(tenant_id, phone_number)` — the single hottest lookup in the entire system (every inbound WhatsApp message).

---

#### 3.4.2 `customer_notes`
**Purpose:** Free-text staff notes about a customer (preferences, allergies, history) — not visible to the AI unless explicitly designed to be (application-layer decision, not assumed here).
**Columns:** `customer_id` UUID; `note` TEXT; `author_user_id` UUID.
+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `customer_id` → `customers.id`; `author_user_id` → `users.id`.
**Indexes:** `idx_customer_notes_customer_id`.
**Relationships:** belongs to `Customer`, authored by `User`.
**Business Rules:** Append-style usage pattern; edits should be rare (soft delete + new note preferred over destructive update, though update is not prohibited at the schema level).
**Expected Row Growth:** Low-moderate per customer.
**Frequently Queried Columns:** `customer_id`.

---

#### 3.4.3 `customer_tags`
**Purpose:** Tenant-defined labels for segmenting customers (e.g., "VIP," "New," "Rebooking Due").
**Columns:** `name` VARCHAR(50); `color` VARCHAR(7) nullable.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_customer_tags_tenant_name` on `(tenant_id, name)`.
**Indexes:** `idx_customer_tags_tenant_id`.
**Relationships:** many-to-many with `Customer` via `CustomerTagAssignment`.
**Expected Row Growth:** Very low — a handful per tenant.
**Frequently Queried Columns:** `tenant_id`.

---

#### 3.4.4 `customer_tag_assignments` *(Junction)*
**Purpose:** Many-to-many link between `Customer` and `CustomerTag`.
**Columns:** `customer_id` UUID; `customer_tag_id` UUID.
+ Standard Tenant-Owned Fields (minus `updated_by` — assignment is create/delete only, no meaningful update).
**Primary Key:** `id`. **Foreign Keys:** `customer_id` → `customers.id`; `customer_tag_id` → `customer_tags.id`.
**Unique Constraints:** `uq_customer_tag_assignments` on `(customer_id, customer_tag_id)`.
**Indexes:** `idx_customer_tag_assignments_customer_id`; `idx_customer_tag_assignments_tag_id`.
**Expected Row Growth:** Moderate — proportional to (customers × avg tags per customer).
**Frequently Queried Columns:** `customer_id`.

---

### 3.5 Appointments

#### 3.5.1 `appointments`
**Purpose:** The core business record — a scheduled booking. The single most business-critical table in the system.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `customer_id` | UUID | No | — | FK → `customers.id` |
| `employee_id` | UUID | No | — | FK → `employees.id` |
| `conversation_id` | UUID | Yes | `null` | FK → `conversations.id`; null if booked manually by staff, not via WhatsApp |
| `status` | AppointmentStatus enum | No | `'CONFIRMED'` | `PENDING`, `CONFIRMED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`, `NO_SHOW` |
| `start_time` | TIMESTAMPTZ | No | — | |
| `end_time` | TIMESTAMPTZ | No | — | Derived from sum of `AppointmentService` durations at creation time, stored for direct query efficiency |
| `total_price_cents` | INTEGER | No | — | Snapshot sum, see `AppointmentService` |
| `currency` | CHAR(3) | No | — | |
| `notes` | TEXT | Yes | `null` | Staff/AI-entered notes |
| `cancellation_reason` | VARCHAR(255) | Yes | `null` | |
| `cancelled_at` | TIMESTAMPTZ | Yes | `null` | |
| `rescheduled_from_appointment_id` | UUID | Yes | `null` | Self-referential — links a reschedule chain |
| `reminder_sent_at` | TIMESTAMPTZ | Yes | `null` | Prevents duplicate reminder sends (also idempotency-backed in Redis, Section 10) |

+ Standard Tenant-Owned Fields + Standard Soft-Delete Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `customer_id` → `customers.id`; `employee_id` → `employees.id`; `conversation_id` → `conversations.id` (nullable); `rescheduled_from_appointment_id` → `appointments.id` (self, nullable).
**Unique Constraints:** none direct (conflict prevention is a business rule enforced at the application/transaction layer, not a simple unique constraint, because it depends on time-range overlap — see Business Rules and Section 6).
**Indexes:** `idx_appointments_tenant_employee_start` composite `(tenant_id, employee_id, start_time)` — the primary conflict-check/availability query path; `idx_appointments_tenant_customer` composite `(tenant_id, customer_id)`; `idx_appointments_tenant_status_start` composite `(tenant_id, status, start_time)` — dashboard calendar queries; partial `WHERE deleted_at IS NULL`.
**Relationships:** belongs to `Tenant`, `Customer`, `Employee`; optionally `Conversation`; has many `AppointmentService`, `AppointmentHistory`.
**Business Rules:** No two `CONFIRMED`/`PENDING` appointments for the same `employee_id` may have overlapping `[start_time, end_time)` ranges within a tenant — enforced at the application layer inside a database transaction (an `EXCLUDE` constraint using the `btree_gist` extension is a viable future hardening option, flagged in Section 13, but application-layer enforcement plus a Redis booking lock (Section 10) is the MVP approach for compatibility with Prisma's constraint modeling). Cancelling/rescheduling within `cancellation_notice_hours` (from `TenantSettings`) is a business-rule check, not a schema constraint.
**Expected Row Growth:** The highest-volume core-business table — Section 12 models this explicitly (targeting 1M+ rows).
**Frequently Queried Columns:** `(tenant_id, employee_id, start_time)`, `(tenant_id, status, start_time)`, `customer_id`.

---

#### 3.5.2 `appointment_services` *(Junction + Historical Snapshot)*
**Purpose:** Links an `Appointment` to one or more `Service` rows (a single visit may include multiple services), and **snapshots** the service's name/price/duration at time of booking so later catalog changes never rewrite booking history (1.4).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `appointment_id` | UUID | No | — | |
| `service_id` | UUID | No | — | FK for traceability, but not authoritative for historical values |
| `service_name_snapshot` | VARCHAR(150) | No | — | |
| `duration_minutes_snapshot` | INTEGER | No | — | |
| `price_cents_snapshot` | INTEGER | No | — | |
| `employee_id` | UUID | No | — | The specific employee performing *this* service (usually same as `appointment.employee_id`, but modeled explicitly for a future multi-staff-per-visit scenario) |
| `sequence_order` | SMALLINT | No | `0` | Order within a multi-service visit |

+ Standard Tenant-Owned Fields (create-only — no meaningful `updated_by` beyond initial creation).
**Primary Key:** `id`. **Foreign Keys:** `appointment_id` → `appointments.id`; `service_id` → `services.id`; `employee_id` → `employees.id`.
**Indexes:** `idx_appointment_services_appointment_id`; `idx_appointment_services_service_id` (for "how many times was this service booked" reporting).
**Relationships:** belongs to `Appointment`; references `Service` (for traceability only) and `Employee`.
**Business Rules:** `appointment.total_price_cents` and `appointment.end_time` are derived from the sum/max of this table's rows at creation time — any change to an appointment's services requires recomputing and updating those denormalized parent fields within the same transaction.
**Expected Row Growth:** Slightly higher than `appointments` (multi-service visits produce >1 row per appointment).
**Frequently Queried Columns:** `appointment_id`.

---

#### 3.5.3 `appointment_history` *(Append-Only)*
**Purpose:** Immutable change log for appointments — required for FR-28 (audit trail for AI booking actions) and dispute resolution (PROJECT_REQUIREMENTS.md Section 17 risk mitigation).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `appointment_id` | UUID | No | — | |
| `action` | VARCHAR(30) | No | — | `CREATED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`, `MODIFIED` |
| `previous_state` | JSONB | Yes | `null` | Snapshot of relevant fields before the change |
| `new_state` | JSONB | No | — | Snapshot after the change |
| `actor_type` | ActorType enum | No | — | |
| `actor_id` | UUID | Yes | `null` | FK → `users.id` when `actor_type = 'USER'` |
| `ai_prompt_version` | VARCHAR(20) | Yes | `null` | Set when `actor_type = 'AI'`, ties to SYSTEM_ARCHITECTURE.md 5.6 prompt versioning |
| `conversation_id` | UUID | Yes | `null` | FK → `conversations.id`, if the action originated from a WhatsApp conversation |

`tenant_id` (denormalized for scoping) + `created_at` (no `updated_at`/soft-delete — this table is strictly append-only, never updated or deleted).
**Primary Key:** `id` (UUIDv7, per 1.5, since this is a high-write, time-ordered table). **Foreign Keys:** `tenant_id` → `tenants.id`; `appointment_id` → `appointments.id`; `actor_id` → `users.id` (nullable); `conversation_id` → `conversations.id` (nullable).
**Indexes:** `idx_appointment_history_appointment_id`; `idx_appointment_history_tenant_created` composite `(tenant_id, created_at)`.
**Relationships:** belongs to `Appointment`; optionally references `User` and `Conversation`.
**Business Rules:** Rows are never updated or deleted (application enforces insert-only access at the repository layer, per SYSTEM_ARCHITECTURE.md 9.6's audit-log tamper-evidence principle). Every `appointments` mutation must write a corresponding row in the same transaction.
**Expected Row Growth:** ≥ 1:1 with appointment mutations — likely 1.5–3× the row count of `appointments` given reschedules/cancellations. Prime candidate for time-based partitioning at scale (Section 12).
**Frequently Queried Columns:** `appointment_id`, `(tenant_id, created_at)`.

---

### 3.6 Conversations

#### 3.6.1 `conversations`
**Purpose:** A WhatsApp conversation thread between one customer and one tenant.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `customer_id` | UUID | No | — | FK → `customers.id` |
| `whatsapp_account_id` | UUID | No | — | FK → `whatsapp_accounts.id` |
| `status` | ConversationStatus enum | No | `'OPEN_AI'` | `OPEN_AI`, `ESCALATED`, `HUMAN_HANDLING`, `RESOLVED`, `CLOSED` |
| `escalated_at` | TIMESTAMPTZ | Yes | `null` | |
| `escalation_reason` | VARCHAR(255) | Yes | `null` | |
| `assigned_user_id` | UUID | Yes | `null` | FK → `users.id`; staff member handling an escalated thread |
| `last_message_at` | TIMESTAMPTZ | No | `now()` | Denormalized for fast inbox sorting |
| `resolved_at` | TIMESTAMPTZ | Yes | `null` | |

+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `customer_id` → `customers.id`; `whatsapp_account_id` → `whatsapp_accounts.id`; `assigned_user_id` → `users.id` (nullable).
**Unique Constraints:** none forced — a customer can have sequential conversation threads over time (e.g., re-opened after `CLOSED`); "the current open thread" is an application-layer query (`status != CLOSED` ordered by `last_message_at`), not a uniqueness constraint.
**Indexes:** `idx_conversations_tenant_customer` composite `(tenant_id, customer_id)`; `idx_conversations_tenant_status` composite `(tenant_id, status)` — powers the human-handoff queue (FR-13, `Dashboard` module); `idx_conversations_last_message_at`.
**Relationships:** belongs to `Tenant`, `Customer`, `WhatsAppAccount`; optionally assigned to `User`; has many `Message`; has one `AIContext`, one `ConversationSummary`.
**Business Rules:** When `status = 'ESCALATED'` or `'HUMAN_HANDLING'`, the AI module must not auto-respond (SYSTEM_ARCHITECTURE.md 5.8) — enforced in application logic reading this field.
**Expected Row Growth:** Moderate-high — proportional to unique WhatsApp threads; likely several per active customer over their lifetime.
**Frequently Queried Columns:** `(tenant_id, status)`, `(tenant_id, customer_id)`.

---

#### 3.6.2 `messages`
**Purpose:** Individual inbound/outbound WhatsApp messages — the highest-volume table in the schema (Section 12).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `conversation_id` | UUID | No | — | |
| `direction` | MessageDirection enum | No | — | `INBOUND`, `OUTBOUND` |
| `sender_type` | MessageSenderType enum | No | — | `CUSTOMER`, `AI`, `STAFF`, `SYSTEM` |
| `sender_user_id` | UUID | Yes | `null` | FK → `users.id`, set when `sender_type = 'STAFF'` |
| `message_type` | MessageType enum | No | `'TEXT'` | `TEXT`, `IMAGE`, `AUDIO`, `VIDEO`, `DOCUMENT`, `TEMPLATE`, `INTERACTIVE`, `LOCATION` |
| `content` | TEXT | Yes | `null` | Text body; null for pure-media messages |
| `media_id` | UUID | Yes | `null` | FK → `media.id` |
| `whatsapp_message_id` | VARCHAR(100) | Yes | `null` | Meta's message ID — idempotency key (Section 6, WhatsApp architecture 6.6) |
| `status` | MessageStatus enum | No | `'QUEUED'` | `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED` |
| `failure_reason` | VARCHAR(255) | Yes | `null` | |
| `ai_prompt_version` | VARCHAR(20) | Yes | `null` | Set when `sender_type = 'AI'` |
| `raw_payload` | JSONB | Yes | `null` | Original webhook/API payload for debugging |

`tenant_id` (denormalized) + `created_at` (immutable) — **no `updated_at` in the traditional sense**; `status` changes are tracked via `updated_at` present but message content itself is immutable once created. No soft delete (messages are retained per the compliance/audit trail need, not user-deletable).
**Primary Key:** `id` (UUIDv7, per 1.5). **Foreign Keys:** `tenant_id` → `tenants.id`; `conversation_id` → `conversations.id`; `sender_user_id` → `users.id` (nullable); `media_id` → `media.id` (nullable).
**Unique Constraints:** partial `uq_messages_whatsapp_message_id` on `whatsapp_message_id` `WHERE whatsapp_message_id IS NOT NULL` — the core idempotency guard against Meta's at-least-once webhook delivery (SYSTEM_ARCHITECTURE.md 6.6).
**Indexes:** `idx_messages_conversation_created` composite `(conversation_id, created_at)` — the primary read pattern (render/scroll a conversation thread, and AI context assembly, SYSTEM_ARCHITECTURE.md 5.2); `idx_messages_tenant_created` composite `(tenant_id, created_at)` for tenant-wide volume reporting.
**Relationships:** belongs to `Conversation`; optionally references `User` (staff sender) and `Media`.
**Business Rules:** Immutable once persisted (status field is the one legitimately-mutable exception, updated by delivery-receipt webhooks). `whatsapp_message_id` uniqueness is the concrete mechanism behind the idempotency requirement in SYSTEM_ARCHITECTURE.md Section 6.6.
**Expected Row Growth:** The single largest table in the system by row count — explicitly modeled in Section 12 (10 million+ target). **Primary candidate for time-based table partitioning** (Section 12/13).
**Frequently Queried Columns:** `(conversation_id, created_at)`, `whatsapp_message_id`.

---

#### 3.6.3 `ai_contexts`
**Purpose:** Per-conversation working state the AI module needs across turns beyond raw message history — e.g., "customer is mid-booking-flow, has selected service X, awaiting time confirmation." Complements Redis-based short-term memory (Section 10) with a durable record of the last-known structured state.
**Columns:** `conversation_id` UUID; `current_intent` VARCHAR(50) nullable (e.g. `BOOKING`, `RESCHEDULING`, `FAQ`); `state` JSONB default `'{}'` (structured slot-filling data, e.g. selected service/employee/time pending confirmation); `last_tool_call` VARCHAR(50) nullable; `updated_at` TIMESTAMPTZ.
`tenant_id` (denormalized).
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `conversation_id` → `conversations.id`.
**Unique Constraints:** `uq_ai_contexts_conversation_id` (1:1 with `Conversation`).
**Indexes:** covered by unique constraint.
**Relationships:** one-to-one with `Conversation`.
**Business Rules:** `state` is explicitly JSONB (1.1) because its shape evolves as AI capabilities/tools evolve, and it is inherently ephemeral working memory, not a durable business record — it may be cleared/reset when a conversation resolves or goes stale.
**Expected Row Growth:** One row per active conversation (roughly tracks `conversations` row count, though old resolved conversations' context can be pruned more aggressively than the conversation record itself).
**Frequently Queried Columns:** `conversation_id` — read on every AI turn.

---

#### 3.6.4 `conversation_summaries`
**Purpose:** Denormalized rollup of a conversation for fast dashboard display and AI context-window optimization (SYSTEM_ARCHITECTURE.md 5.7) — avoids re-reading/re-summarizing the full `Message` history on every reference.
**Columns:** `conversation_id` UUID; `summary_text` TEXT; `message_count` INTEGER; `last_customer_intent` VARCHAR(100) nullable; `generated_at` TIMESTAMPTZ; `ai_prompt_version` VARCHAR(20) nullable.
`tenant_id` (denormalized).
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `conversation_id` → `conversations.id`.
**Unique Constraints:** `uq_conversation_summaries_conversation_id` (1:1).
**Indexes:** covered by unique constraint.
**Relationships:** one-to-one with `Conversation`.
**Business Rules:** Explicitly a **derived/cache table** — regeneratable from `Message` history at any time; never treated as authoritative source data. Regenerated periodically or on conversation resolution, not on every message (cost/latency tradeoff, Section 5.7).
**Expected Row Growth:** Tracks `conversations` (roughly 1:1 for conversations that reach a meaningful length).
**Frequently Queried Columns:** `conversation_id`.

---

### 3.7 WhatsApp

#### 3.7.1 `whatsapp_accounts`
**Purpose:** One-to-one mapping of a tenant to its connected WhatsApp Business Cloud API number/account (FR-6).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `phone_number` | VARCHAR(20) | No | — | E.164 — the salon's WhatsApp Business number |
| `whatsapp_phone_number_id` | VARCHAR(100) | No | — | Meta's phone number ID (webhook routing key, Section 6/6.3) |
| `whatsapp_business_account_id` | VARCHAR(100) | No | — | Meta's WABA ID |
| `access_token_encrypted` | TEXT | No | — | Encrypted at the application layer before storage (SYSTEM_ARCHITECTURE.md 9.4) |
| `connection_status` | VARCHAR(20) | No | `'PENDING'` | `PENDING`, `CONNECTED`, `DISCONNECTED`, `ERROR` |
| `connected_at` | TIMESTAMPTZ | Yes | `null` | |
| `last_health_check_at` | TIMESTAMPTZ | Yes | `null` | |

+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_whatsapp_accounts_tenant_id` (1:1 with `Tenant` — one WhatsApp number per tenant at MVP, per PROJECT_REQUIREMENTS.md MVP scope); `uq_whatsapp_accounts_phone_number_id` on `whatsapp_phone_number_id` — this is the **critical tenant-resolution index**: every inbound webhook resolves tenant by looking up this column (SYSTEM_ARCHITECTURE.md 8.3).
**Indexes:** covered by unique constraints.
**Relationships:** one-to-one with `Tenant`; has many `Conversation`, `TemplateMessage`.
**Business Rules:** `access_token_encrypted` is never logged or exposed via any read API in plaintext. `whatsapp_phone_number_id` uniqueness is what makes tenant-resolution-by-webhook safe and unambiguous (SYSTEM_ARCHITECTURE.md Section 8.3's webhook trust-boundary design depends directly on this constraint).
**Expected Row Growth:** Exactly one row per tenant (at MVP's single-number-per-tenant scope).
**Frequently Queried Columns:** `whatsapp_phone_number_id` — read on literally every inbound webhook.

---

#### 3.7.2 `whatsapp_webhook_events` *(Global ingestion log)*
**Purpose:** Raw log of every inbound webhook payload from Meta, persisted **before** tenant resolution/processing — the durable backstop behind the idempotency and retry mechanics in SYSTEM_ARCHITECTURE.md Section 6.5/6.6.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `whatsapp_message_id` | VARCHAR(100) | Yes | `null` | Null for non-message events (e.g., account status change) |
| `event_type` | VARCHAR(50) | No | — | `MESSAGE`, `STATUS`, `ACCOUNT_UPDATE`, etc. |
| `payload` | JSONB | No | — | Raw event body |
| `tenant_id` | UUID | Yes | `null` | Resolved asynchronously by the processing worker; null until resolved |
| `processing_status` | VARCHAR(20) | No | `'PENDING'` | `PENDING`, `PROCESSED`, `FAILED`, `IGNORED` |
| `processed_at` | TIMESTAMPTZ | Yes | `null` | |
| `error_message` | TEXT | Yes | `null` | |
| `created_at` | TIMESTAMPTZ | No | `now()` | |

**Primary Key:** `id` (UUIDv7). **Foreign Keys:** `tenant_id` → `tenants.id` (nullable — this table is explicitly a **global ingestion table**, per Section 5.6, since the raw webhook arrives before tenant identity is known).
**Unique Constraints:** partial `uq_whatsapp_webhook_events_message_id` on `whatsapp_message_id` `WHERE whatsapp_message_id IS NOT NULL` (idempotency dedup at the raw-ingestion layer, ahead of the `messages.whatsapp_message_id` constraint which dedups at the processed layer — belt-and-suspenders).
**Indexes:** `idx_whatsapp_webhook_events_processing_status` (worker polling/retry queries); `idx_whatsapp_webhook_events_created_at`.
**Business Rules:** Written synchronously in the webhook controller before any async processing (SYSTEM_ARCHITECTURE.md 6.1) so no inbound event can be lost even if downstream processing fails.
**Expected Row Growth:** Very high — one row per inbound Meta webhook call, likely exceeding `messages` row count (includes status/receipt events, not just messages). Strong candidate for aggressive time-based retention/archival (Section 12) since its value is primarily short-term debugging/replay, not long-term business history (that's `messages`' job).
**Frequently Queried Columns:** `whatsapp_message_id`, `processing_status`.

---

#### 3.7.3 `template_messages`
**Purpose:** Registry of Meta-approved WhatsApp message templates a tenant is permitted to send outside the 24-hour customer-service window (e.g., appointment reminders) — a compliance requirement (PROJECT_REQUIREMENTS.md Section 20, SYSTEM_ARCHITECTURE.md 6.3).
**Columns:** `name` VARCHAR(100); `whatsapp_template_id` VARCHAR(100); `category` VARCHAR(30) (`UTILITY`, `MARKETING`, etc.); `language_code` VARCHAR(10); `approval_status` VARCHAR(20) (`PENDING`, `APPROVED`, `REJECTED`); `body_text` TEXT; `variable_count` SMALLINT default `0`.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_template_messages_tenant_name_lang` on `(tenant_id, name, language_code)`.
**Indexes:** `idx_template_messages_tenant_id`.
**Relationships:** belongs to `Tenant`; referenced by outbound `Message` rows of `message_type = 'TEMPLATE'`.
**Business Rules:** Only `approval_status = 'APPROVED'` templates may be used for proactive sends (application-layer enforcement mirroring Meta's own policy).
**Expected Row Growth:** Very low — a handful per tenant (reminder template, confirmation template, etc.).
**Frequently Queried Columns:** `tenant_id`.

---

#### 3.7.4 `media`
**Purpose:** Metadata for media files exchanged via WhatsApp or uploaded as salon assets, backed by S3-compatible storage (SYSTEM_ARCHITECTURE.md `Files`/`WhatsApp` modules).
**Columns:** `storage_key` VARCHAR(500) (S3 object key); `content_type` VARCHAR(100); `size_bytes` BIGINT; `source` VARCHAR(20) (`WHATSAPP_INBOUND`, `WHATSAPP_OUTBOUND`, `UPLOAD`); `whatsapp_media_id` VARCHAR(100) nullable (Meta's transient media ID, retained for traceability even after download per SYSTEM_ARCHITECTURE.md 6.8).
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Indexes:** `idx_media_tenant_id`.
**Relationships:** referenced by `Message.media_id`; may also be referenced generically via `File` (Section 3.10.3) — see 3.7.4 note below.
**Business Rules:** Note on overlap with `File` (3.10.3): `Media` is specifically WhatsApp-message-attached content with message-specific metadata (Meta media ID, inbound/outbound direction); `File` is the general-purpose storage abstraction for everything else (branding, exports). This split mirrors the distinct lifecycles: `Media` rows are tied to conversation retention policy, `File` rows to their respective owning feature.
**Expected Row Growth:** Moderate — proportional to the fraction of messages containing media.
**Frequently Queried Columns:** `tenant_id`, `whatsapp_media_id`.

---

### 3.8 Billing

#### 3.8.1 `plans` *(Global)*
**Purpose:** Platform-defined subscription tier definitions (e.g., Starter/Pro/Enterprise) — not tenant-owned; shared reference data.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `name` | VARCHAR(50) | No | — | |
| `stripe_price_id` | VARCHAR(100) | No | — | Stripe's price object ID |
| `monthly_price_cents` | INTEGER | No | — | |
| `currency` | CHAR(3) | No | `'USD'` | |
| `max_staff` | INTEGER | Yes | `null` | Plan limit; `null` = unlimited |
| `max_messages_per_month` | INTEGER | Yes | `null` | Usage limit (FR-22) |
| `max_locations` | INTEGER | No | `1` | |
| `is_active` | BOOLEAN | No | `true` | Retired plans kept for historical subscriptions |
| `trial_days` | INTEGER | No | `14` | |
| `created_at` / `updated_at` | TIMESTAMPTZ | No | `now()` | |

**Primary Key:** `id`. **Unique Constraints:** `uq_plans_stripe_price_id`.
**Indexes:** `idx_plans_is_active`.
**Relationships:** has many `Subscription`.
**Business Rules:** Retired plans are deactivated (`is_active = false`), never deleted, since existing `Subscription` rows must retain a valid reference.
**Expected Row Growth:** Static — a handful of plan tiers.
**Frequently Queried Columns:** `is_active` (plan-selection screen).

---

#### 3.8.2 `subscriptions`
**Purpose:** A tenant's current subscription state — the local mirror of Stripe's subscription object (SYSTEM_ARCHITECTURE.md `Billing` module).
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `plan_id` | UUID | No | — | FK → `plans.id` |
| `stripe_customer_id` | VARCHAR(100) | No | — | |
| `stripe_subscription_id` | VARCHAR(100) | Yes | `null` | Null during trial-without-payment-method |
| `status` | SubscriptionStatus enum | No | `'TRIALING'` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `INCOMPLETE`, `UNPAID` |
| `current_period_start` | TIMESTAMPTZ | Yes | `null` | |
| `current_period_end` | TIMESTAMPTZ | Yes | `null` | |
| `cancel_at_period_end` | BOOLEAN | No | `false` | |
| `canceled_at` | TIMESTAMPTZ | Yes | `null` | |
| `coupon_id` | UUID | Yes | `null` | FK → `coupons.id` |
| `messages_used_current_period` | INTEGER | No | `0` | Usage-limit tracking (FR-22) |

+ Standard Tenant-Owned Fields (`updated_by` typically `SYSTEM` — driven by Stripe webhooks).
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `plan_id` → `plans.id`; `coupon_id` → `coupons.id` (nullable).
**Unique Constraints:** `uq_subscriptions_tenant_id` (1:1 with `Tenant`); `uq_subscriptions_stripe_subscription_id`.
**Indexes:** `idx_subscriptions_status` (dunning/admin queries); `idx_subscriptions_stripe_customer_id`.
**Relationships:** one-to-one with `Tenant`; belongs to `Plan`; optionally to `Coupon`; has many `Invoice`, `Payment`.
**Business Rules:** `status` is authoritatively driven by Stripe webhooks, not direct application writes (Stripe is the source of truth; this table is a queryable mirror) — see Section 9.4 lifecycle. `messages_used_current_period` resets to `0` on each new billing period, updated by the same job that processes usage.
**Expected Row Growth:** Exactly one row per tenant.
**Frequently Queried Columns:** `tenant_id`, `status`, `stripe_customer_id` (webhook resolution).

---

#### 3.8.3 `invoices`
**Purpose:** Local mirror of Stripe invoices for in-app billing history display (FR-23).
**Columns:** `stripe_invoice_id` VARCHAR(100); `amount_due_cents` INTEGER; `amount_paid_cents` INTEGER; `currency` CHAR(3); `status` InvoiceStatus enum (`DRAFT`,`OPEN`,`PAID`,`VOID`,`UNCOLLECTIBLE`); `invoice_pdf_file_id` UUID nullable (FK → `files.id`); `issued_at` TIMESTAMPTZ; `due_at` TIMESTAMPTZ nullable; `paid_at` TIMESTAMPTZ nullable.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `invoice_pdf_file_id` → `files.id` (nullable).
**Unique Constraints:** `uq_invoices_stripe_invoice_id`.
**Indexes:** `idx_invoices_tenant_issued` composite `(tenant_id, issued_at)`.
**Relationships:** belongs to `Tenant` (implicitly via `Subscription`, but denormalized `tenant_id` for direct scoped queries per 1.11); has many `Payment`.
**Business Rules:** Synced from Stripe webhook events; never created directly by application logic.
**Expected Row Growth:** One row per tenant per billing cycle — moderate, linear with tenant-months.
**Frequently Queried Columns:** `(tenant_id, issued_at)`.

---

#### 3.8.4 `payments`
**Purpose:** Local mirror of individual Stripe payment attempts (for dunning visibility and reconciliation).
**Columns:** `invoice_id` UUID nullable; `stripe_payment_intent_id` VARCHAR(100); `amount_cents` INTEGER; `currency` CHAR(3); `status` PaymentStatus enum (`SUCCEEDED`,`FAILED`,`PENDING`,`REFUNDED`); `failure_code` VARCHAR(50) nullable; `failure_message` VARCHAR(255) nullable; `attempted_at` TIMESTAMPTZ.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `invoice_id` → `invoices.id` (nullable).
**Unique Constraints:** `uq_payments_stripe_payment_intent_id`.
**Indexes:** `idx_payments_tenant_id`; `idx_payments_status` (dunning queries).
**Relationships:** optionally belongs to `Invoice`.
**Business Rules:** Failed payments here are what trigger the `Notifications`-driven dunning flow (FR-25).
**Expected Row Growth:** Moderate — one or more per invoice (retries).
**Frequently Queried Columns:** `status`, `tenant_id`.

---

#### 3.8.5 `coupons` *(Global)*
**Purpose:** Platform-wide discount codes, optionally tenant-segment-restricted.
**Columns:** `code` VARCHAR(50); `stripe_coupon_id` VARCHAR(100); `discount_type` VARCHAR(20) (`PERCENT`,`FIXED`); `discount_value` INTEGER; `duration_type` VARCHAR(20) (`ONCE`,`REPEATING`,`FOREVER`); `duration_in_months` INTEGER nullable; `max_redemptions` INTEGER nullable; `redemption_count` INTEGER default `0`; `expires_at` TIMESTAMPTZ nullable; `is_active` BOOLEAN default `true`.
**Primary Key:** `id`. **Unique Constraints:** `uq_coupons_code`; `uq_coupons_stripe_coupon_id`.
**Indexes:** `idx_coupons_code`; `idx_coupons_is_active`.
**Relationships:** referenced by `Subscription.coupon_id`.
**Business Rules:** `redemption_count` incremented transactionally on use; redemption blocked once `max_redemptions` reached or `expires_at` passed.
**Expected Row Growth:** Low — marketing-driven, created in small batches.
**Frequently Queried Columns:** `code`.

---

### 3.9 Notifications

#### 3.9.1 `notifications`
**Purpose:** A logical notification to be sent to a platform user (not a WhatsApp customer message — that's `Message`) — email primarily, extensible to other channels.
**Columns:** `recipient_user_id` UUID; `channel` NotificationChannel enum (`EMAIL`,`SMS`,`IN_APP`); `template_key` VARCHAR(100); `subject` VARCHAR(255) nullable; `data` JSONB default `'{}'` (template variables); `status` NotificationStatus enum (`PENDING`,`SENT`,`FAILED`); `sent_at` TIMESTAMPTZ nullable; `failure_reason` VARCHAR(255) nullable.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `recipient_user_id` → `users.id`.
**Indexes:** `idx_notifications_recipient_user_id`; `idx_notifications_status` (retry/processing queue queries).
**Relationships:** belongs to `Tenant`; sent to a `User`.
**Business Rules:** Represents the queued/logical intent to notify; `NotificationLog` (below) records the concrete delivery attempt(s) — separated so retries don't multiply the logical-notification row.
**Expected Row Growth:** Moderate — proportional to platform events (invites, payment failures, weekly summaries).
**Frequently Queried Columns:** `status`.

---

#### 3.9.2 `notification_logs`
**Purpose:** Delivery-attempt-level log for each `Notification` — supports retry tracking and provider-response debugging.
**Columns:** `notification_id` UUID; `attempt_number` SMALLINT; `provider_response` JSONB nullable; `succeeded` BOOLEAN; `attempted_at` TIMESTAMPTZ.
`tenant_id` (denormalized) + `created_at`.
**Primary Key:** `id` (UUIDv7). **Foreign Keys:** `tenant_id` → `tenants.id`; `notification_id` → `notifications.id`.
**Indexes:** `idx_notification_logs_notification_id`.
**Relationships:** belongs to `Notification`.
**Business Rules:** Append-only.
**Expected Row Growth:** ≥ `notifications` row count (multiple attempts possible).
**Frequently Queried Columns:** `notification_id`.

---

### 3.10 System

#### 3.10.1 `audit_logs`
**Purpose:** Immutable, queryable trail of business-significant actions — the concrete implementation of FR-28 and SYSTEM_ARCHITECTURE.md Section 9.6.
**Columns:**
| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `action` | VARCHAR(50) | No | — | e.g. `APPOINTMENT_CREATED`, `SETTINGS_UPDATED`, `SUBSCRIPTION_CHANGED`, `TENANT_SUSPENDED` — documented, extensible string rather than a rigid enum (1.11 note) |
| `entity_type` | VARCHAR(50) | No | — | e.g. `Appointment`, `TenantSettings` |
| `entity_id` | UUID | No | — | |
| `actor_type` | ActorType enum | No | — | |
| `actor_id` | UUID | Yes | `null` | |
| `metadata` | JSONB | Yes | `null` | Flexible action-specific detail (e.g., changed fields, before/after) |
| `ip_address` | VARCHAR(45) | Yes | `null` | |

`tenant_id` **nullable** (a platform-level Super Admin action, e.g., cross-tenant tenant suspension, may have no single owning tenant context, or is attributed to the affected tenant — modeled as nullable to cover both) + `created_at` (immutable, no update/delete).
**Primary Key:** `id` (UUIDv7). **Foreign Keys:** `tenant_id` → `tenants.id` (nullable); `actor_id` → `users.id` (nullable).
**Indexes:** `idx_audit_logs_tenant_created` composite `(tenant_id, created_at)`; `idx_audit_logs_entity` composite `(entity_type, entity_id)`.
**Relationships:** optionally belongs to `Tenant`; optionally references `User`.
**Business Rules:** No update/delete API surface (SYSTEM_ARCHITECTURE.md 9.6, tamper-evidence). Super Admin cross-tenant reads are permitted; tenant-scoped roles only ever see their own tenant's rows.
**Expected Row Growth:** High — one row per meaningful mutation across the platform. Time-based partitioning candidate at scale (Section 12).
**Frequently Queried Columns:** `(tenant_id, created_at)`, `(entity_type, entity_id)`.

---

#### 3.10.2 `activity_logs`
**Purpose:** Lower-signal, high-frequency activity trail (logins, API calls if needed) kept separate from `AuditLog` to avoid diluting the business-critical trail (1.7).
**Columns:** `activity_type` VARCHAR(50) (e.g. `LOGIN`, `LOGOUT`, `API_REQUEST`); `user_id` UUID nullable; `metadata` JSONB nullable; `ip_address` VARCHAR(45) nullable.
`tenant_id` (nullable, same rationale as `audit_logs`) + `created_at`.
**Primary Key:** `id` (UUIDv7). **Foreign Keys:** `tenant_id` → `tenants.id` (nullable); `user_id` → `users.id` (nullable).
**Indexes:** `idx_activity_logs_tenant_created` composite `(tenant_id, created_at)`; `idx_activity_logs_user_id`.
**Business Rules:** Highest write volume of any log table if fully utilized — subject to the most aggressive retention policy (Section 9/12), since its value decays fastest.
**Expected Row Growth:** Highest of the log tables — strong partitioning/retention candidate.
**Frequently Queried Columns:** `(tenant_id, created_at)`, `user_id`.

---

#### 3.10.3 `files`
**Purpose:** General-purpose metadata for objects stored in S3-compatible storage — branding assets, invoice PDFs, exports (distinct from `Media`, see 3.7.4 note).
**Columns:** `storage_key` VARCHAR(500); `content_type` VARCHAR(100); `size_bytes` BIGINT; `owner_type` FileOwnerType enum (`TENANT_BRANDING`,`INVOICE_EXPORT`,`CUSTOMER_UPLOAD`,`REPORT_EXPORT`); `owner_id` UUID nullable (polymorphic reference, interpreted per `owner_type`); `uploaded_by_user_id` UUID nullable.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`; `uploaded_by_user_id` → `users.id` (nullable). *(`owner_id` is intentionally not a hard FK — it is polymorphic by `owner_type`; application-layer integrity, a documented, deliberate exception to "always index/enforce FKs," consistent with common patterns for polymorphic file-attachment tables.)*
**Indexes:** `idx_files_tenant_id`; `idx_files_owner` composite `(owner_type, owner_id)`.
**Business Rules:** Actual binary content lives in S3-compatible storage; this table is metadata-only, per SYSTEM_ARCHITECTURE.md Section 1.3 (Files module responsibility).
**Expected Row Growth:** Low-moderate — proportional to branding uploads and generated documents (not messaging media, which is `Media`).
**Frequently Queried Columns:** `(owner_type, owner_id)`.

---

#### 3.10.4 `api_keys`
**Purpose:** Reserved for future tenant-facing API access (not in MVP functional scope per PROJECT_REQUIREMENTS.md, but included here as the schema should not block this common SaaS extension without a migration later).
**Columns:** `key_hash` VARCHAR(255); `name` VARCHAR(100); `last_used_at` TIMESTAMPTZ nullable; `expires_at` TIMESTAMPTZ nullable; `revoked_at` TIMESTAMPTZ nullable; `scopes` JSONB default `'[]'`.
+ Standard Tenant-Owned Fields.
**Primary Key:** `id`. **Foreign Keys:** `tenant_id` → `tenants.id`.
**Unique Constraints:** `uq_api_keys_key_hash`.
**Indexes:** `idx_api_keys_tenant_id`.
**Business Rules:** Not exposed via any UI/API at MVP launch — table exists to avoid a disruptive future migration, consistent with the architecture doc's "additive, not disruptive" extension philosophy (SYSTEM_ARCHITECTURE.md Section 12, D-series decisions).
**Expected Row Growth:** Zero at MVP; low thereafter if/when enabled.
**Frequently Queried Columns:** `key_hash`.

---

#### 3.10.5 `webhook_events` *(Global ingestion — non-WhatsApp, e.g. Stripe)*
**Purpose:** Raw log of inbound webhook events from providers other than WhatsApp (primarily Stripe) — mirrors `whatsapp_webhook_events`' role but for the `Billing` module (SYSTEM_ARCHITECTURE.md Section 9.1, "Software & Data Integrity" — signature-verified before trust).
**Columns:** `provider` VARCHAR(30) (`STRIPE`); `provider_event_id` VARCHAR(100); `event_type` VARCHAR(100); `payload` JSONB; `tenant_id` UUID nullable (resolved from payload metadata); `processing_status` VARCHAR(20) default `'PENDING'`; `processed_at` TIMESTAMPTZ nullable; `error_message` TEXT nullable.
**Primary Key:** `id` (UUIDv7). **Foreign Keys:** `tenant_id` → `tenants.id` (nullable).
**Unique Constraints:** `uq_webhook_events_provider_event_id` on `(provider, provider_event_id)` — Stripe's own idempotency key, dedup at ingestion.
**Indexes:** `idx_webhook_events_processing_status`.
**Business Rules:** Signature verification (Stripe webhook secret) occurs before this row is trusted for processing, though the raw payload may be logged pre-verification for debugging failed-verification attempts (application-layer decision).
**Expected Row Growth:** Moderate — one row per Stripe event per tenant per billing-relevant action.
**Frequently Queried Columns:** `(provider, provider_event_id)`, `processing_status`.

---

#### 3.10.6 `settings` *(Global — platform-level)*
**Purpose:** Platform-wide configuration not specific to any tenant (distinct from `TenantSettings`) — e.g., default AI prompt version in use, global feature flags, platform maintenance-mode flag.
**Columns:** `key` VARCHAR(100); `value` JSONB; `description` VARCHAR(255) nullable; `updated_by_user_id` UUID nullable (Super Admin who last changed it).
`created_at` / `updated_at`.
**Primary Key:** `id`. **Foreign Keys:** `updated_by_user_id` → `users.id` (nullable).
**Unique Constraints:** `uq_settings_key`.
**Indexes:** covered by unique constraint (tiny table, always cache-resident).
**Business Rules:** Super-Admin-only write access (`Admin` module, SYSTEM_ARCHITECTURE.md Section 3.2).
**Expected Row Growth:** Static — a handful of keys.
**Frequently Queried Columns:** `key`.

---

## 4. Relationship Diagram (Described)

> A visual ERD is intentionally not generated per instruction; relationships are described narratively, organized by cardinality, with the business reason each exists.

### 4.1 One-to-One

| Relationship | Why It Exists |
|---|---|
| `Tenant` ↔ `TenantSettings` | Separates rarely-changing identity/profile data (`Tenant`) from frequently-tuned AI/policy configuration (`TenantSettings`), read on a different hot path (every AI turn) than the profile table. |
| `Tenant` ↔ `WhatsAppAccount` | MVP scope is one WhatsApp number per salon (PROJECT_REQUIREMENTS.md MVP Scope); modeled as strict 1:1 now, with the FK direction (`WhatsAppAccount.tenant_id` unique) chosen so a future multi-number-per-tenant upgrade is a constraint relaxation, not a structural rewrite. |
| `Tenant` ↔ `Subscription` | Billing state is a distinct concern from salon profile, owned by the `Billing` module and driven by Stripe webhooks rather than direct tenant edits. |
| `Conversation` ↔ `AIContext` | AI working memory is conversation-scoped, ephemeral, and structurally different (JSONB state machine) from the durable `Conversation` record itself. |
| `Conversation` ↔ `ConversationSummary` | A derived/cache artifact kept structurally distinct from the source-of-truth `Conversation`/`Message` data it summarizes (1.4). |

### 4.2 One-to-Many

| Relationship | Why It Exists |
|---|---|
| `Tenant` → `Employee`, `Service`, `Customer`, `Appointment`, `Conversation`, … (nearly every tenant-owned table) | The foundational multi-tenancy relationship (Section 5) — every tenant owns an independent copy of its operational data. |
| `Employee` → `WorkingHours`, `EmployeeAvailability`, `Appointment` | A staff member has a recurring schedule, ad hoc exceptions, and a history of bookings — each with a different mutation frequency and lifecycle, justifying separate tables rather than one wide `Employee` row. |
| `Category` → `Service` | Optional grouping for catalog organization and future AI-recommendation filtering by category. |
| `Customer` → `Appointment`, `Conversation`, `CustomerNote` | A customer accumulates booking history and message history over time; both must survive independently of each other (e.g., a conversation without a resulting booking, or a manually-created booking without a conversation). |
| `Appointment` → `AppointmentService`, `AppointmentHistory` | A single visit may include multiple services (many-to-many resolved via a snapshotting junction, 4.3); every mutation to the appointment must be independently auditable (append-only history). |
| `Conversation` → `Message` | The core 1:N of the messaging domain — a thread accumulates many messages over its life; volume/scale implications drive the partitioning discussion in Section 12. |
| `WhatsAppAccount` → `Conversation` | All conversations for a tenant flow through its one connected WhatsApp number. |
| `Subscription` → `Invoice` → `Payment` | Mirrors Stripe's own object hierarchy (a subscription generates invoices, an invoice may see multiple payment attempts) so the local mirror stays structurally aligned with the source of truth. |
| `Role` → `User` | Every user has exactly one role at MVP (simple RBAC per SYSTEM_ARCHITECTURE.md 7.3), though the schema does not preclude a future many-to-many if custom/multiple roles per user are introduced. |
| `Plan` → `Subscription` | Many tenants share the same plan tier definition; centralizing plan attributes (limits, pricing) avoids duplicating them per-tenant and keeps plan changes a single-row update. |

### 4.3 Many-to-Many

| Relationship | Junction Table | Why It Exists |
|---|---|---|
| `Employee` ↔ `Service` | `employee_services` | Staff skill-matching — the `Availability` module needs to know which employees are eligible for which services (FR-11, FR-5) to compute valid booking slots; a plain FK on either side couldn't express "many staff can each do many services." |
| `Customer` ↔ `CustomerTag` | `customer_tag_assignments` | A customer can carry multiple segmentation labels ("VIP" and "New" simultaneously), and a tag applies to many customers. |
| `Appointment` ↔ `Service` | `appointment_services` (with historical snapshot, 4.4 note) | A single appointment visit may bundle multiple services (e.g., "haircut + color"), and a service is booked across many appointments over time. |
| `Role` ↔ `Permission` | `role_permissions` | Decouples the coarse role concept from fine-grained permission checks (SYSTEM_ARCHITECTURE.md 7.4), allowing permission sets to be reused/recombined across roles without duplicating boolean flags on `Role` itself. |

### 4.4 Note on Snapshotting Junctions

`AppointmentService` is a many-to-many junction **plus a point-in-time snapshot** (1.4) — it is not a pure link table because the business requirement ("what did the customer pay for this specific visit") must survive independent of later `Service` catalog edits. This is called out separately from the standard many-to-many pattern because it is the one place in the schema where a junction table carries substantive business data of its own, not just foreign keys.

---

## 5. Multi-Tenant Design

### 5.1 tenant_id Strategy

Every tenant-owned table (Section 2) carries a non-nullable `tenant_id` UUID column (with the specific, documented exceptions in 5.4–5.6). This restates and operationalizes the decision made in SYSTEM_ARCHITECTURE.md Section 8.1/8.2 at the schema level: the `tenant_id` column is present even on tables that could technically derive their tenant via a join (e.g., `EmployeeService.tenant_id` is derivable via `Employee.tenant_id`) — this **deliberate denormalization** exists specifically so that every tenant-scoped query can filter directly on the table being queried without a mandatory join, which is both a performance optimization (Section 6) and a safety property (a missing join is a common source of the exact cross-tenant leakage bug this design defends against).

### 5.2 Data Isolation

Isolation is enforced in layers, matching SYSTEM_ARCHITECTURE.md Section 8.5's defense-in-depth approach, with this document specifying the database-layer contribution:
1. **Column presence** — `tenant_id` exists on every relevant table (5.1).
2. **Indexing** — every `tenant_id` is indexed, typically as the leading column of composite indexes (Section 6), so tenant-scoped queries are always efficient, never a reason for a developer to "skip" the filter for performance.
3. **Constraint scoping** — unique constraints that conceptually feel global (e.g., "a phone number is unique") are deliberately scoped to `(tenant_id, ...)` rather than the column alone (e.g., `customers.phone_number` — see 3.4.1), enforcing tenant boundaries as part of the schema's integrity rules, not just query discipline.
4. **Application-layer repository contracts** (SYSTEM_ARCHITECTURE.md 8.2) — out of scope for this document, but this schema is designed assuming that layer exists and is the primary enforcement point at MVP.

### 5.3 Cross-Tenant Protection

Beyond the mechanisms in 5.2, two schema-level details specifically defend against cross-tenant leakage:
- **Every foreign key that crosses into another tenant-owned table is between two rows that must share the same `tenant_id`** — e.g., `Appointment.employee_id` must reference an `Employee` row with the same `tenant_id` as the `Appointment` itself. This is **not enforceable as a native PostgreSQL constraint** across two separate FK columns without a composite foreign key referencing a composite unique key; the recommended approach (flagged for the Prisma schema phase) is either (a) composite foreign keys of `(tenant_id, employee_id)` referencing a composite unique `(tenant_id, id)` on `employees`, or (b) rely on strict application-layer enforcement with database-level integrity as defense-in-depth via option (a) where Prisma's relation modeling supports it. This tradeoff is recorded explicitly in Section 13 (Risks) rather than silently assumed.
- **Webhook-ingested tables resolve tenant_id asynchronously and explicitly** (`whatsapp_webhook_events`, `webhook_events`) rather than guessing/defaulting it — an event that cannot be resolved to a known tenant is left `tenant_id = null` and flagged `processing_status = 'FAILED'`/`'IGNORED'` rather than ever being attached to the wrong tenant.

### 5.4 Shared (Global) Tables

Tables with no `tenant_id` at all — genuinely platform-wide reference or configuration data: `roles`, `permissions`, `role_permissions`, `plans`, `coupons`, `settings`. These are either seeded, rarely-changing reference data (roles/permissions/plans) or explicitly platform-operator-owned (settings, coupons).

### 5.5 Tenant-Owned Tables

The remaining ~35 tables in Section 3 — the large majority of the schema — each carry `tenant_id` and represent data that belongs to exactly one salon.

### 5.6 Global-Ingestion, Tenant-Resolved-Later Tables

`whatsapp_webhook_events` and `webhook_events` are a distinct third category: not global reference data, but not immediately tenant-scoped either, because the tenant identity is only knowable *after* parsing the payload. They carry a **nullable** `tenant_id`, populated by the processing worker, and are called out separately from both 5.4 and 5.5 because treating them as either "clearly global" or "clearly tenant-owned" would be misleading — they are a deliberate, temporary, third state that resolves to tenant-owned within milliseconds under normal operation.

### 5.7 Future Row-Level Security (RLS) Compatibility

This schema is designed so PostgreSQL RLS can be layered on **without any structural migration**, only policy addition — consistent with SYSTEM_ARCHITECTURE.md Section 8.6:
- Every tenant-owned table already has the exact column (`tenant_id`) an RLS policy would key on.
- The recommended future policy shape: `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`, with the application setting `app.current_tenant_id` via `SET LOCAL` at the start of each request-scoped database transaction (a Prisma middleware/extension concern for the next phase, not addressed further here).
- **Not enabled at MVP launch** — same rationale as SYSTEM_ARCHITECTURE.md 8.6: added session-management complexity for a single-Postgres-instance deployment where application-layer enforcement (5.2–5.3) is already the primary, rigorously-tested control. Flagged as the natural hardening step once compliance requirements (e.g., an enterprise customer's security review) justify the operational cost.

---

## 6. Index Strategy

> Full per-table index definitions are given inline in Section 3; this section consolidates the *strategy* and highlights the highest-leverage indexes platform-wide.

### 6.1 Primary Indexes

Every table's `id` UUID primary key is automatically indexed (PostgreSQL default B-tree on the PK). For high-write tables using UUIDv7 (1.5), this primary index also serves as a natural time-ordered index, avoiding the fragmentation a UUIDv4 PK would cause under heavy insert load.

### 6.2 Secondary Indexes (Tenant Scoping)

The single most repeated index pattern in this schema: `idx_<table>_tenant_id` (or a composite leading with `tenant_id`) on every tenant-owned table, per Section 5.1–5.2. This is the backbone of query performance for the entire platform, since virtually no query in the system runs without a tenant filter.

### 6.3 Composite Indexes (Query-Pattern-Driven)

The highest-value composite indexes, tied directly to the user journeys in PROJECT_REQUIREMENTS.md Section 14:

| Index | Table | Query Pattern Served |
|---|---|---|
| `(tenant_id, phone_number)` | `customers` | Every inbound WhatsApp message — resolve customer identity (highest-frequency lookup in the system) |
| `(whatsapp_phone_number_id)` | `whatsapp_accounts` | Every inbound webhook — resolve tenant identity |
| `(tenant_id, employee_id, start_time)` | `appointments` | Availability computation and conflict-prevention checks — the Critical-priority booking-integrity path |
| `(tenant_id, status, start_time)` | `appointments` | Dashboard calendar view, upcoming-appointments queries |
| `(conversation_id, created_at)` | `messages` | Rendering a conversation thread; AI context-window assembly (every AI turn) |
| `(tenant_id, status)` | `conversations` | Human-handoff queue (FR-13, `Dashboard` module) |
| `(employee_id, day_of_week)` | `working_hours` | Every availability computation |
| `(tenant_id, created_at)` | `audit_logs`, `activity_logs`, `appointment_history` | Time-range audit queries and future partitioning boundary |

### 6.4 Search Indexes

- MVP does not require full-text search per PROJECT_REQUIREMENTS.md's functional scope, so no `GIN`/`tsvector` indexes are specified as required at launch.
- **Flagged as a likely near-term addition**: a `GIN` trigram index (`pg_trgm` extension) on `customers(first_name, last_name)` and `services(name)` once staff-facing search-as-you-type is prioritized in the dashboard — noted here so it isn't a surprise schema change later, but not included in the MVP index set to avoid unused-index write overhead.

### 6.5 Performance Considerations

- **Composite index column order matters and is chosen deliberately**: `tenant_id` always leads (since it's present in effectively every query), followed by the next-most-selective/most-common filter, followed by any sort column (e.g., `start_time`) last — allowing the same index to serve both filtering and ordering (`ORDER BY start_time`) without a separate sort step.
- **Partial indexes** (`WHERE deleted_at IS NULL`) keep the common-case index small and fast by excluding soft-deleted rows that are rarely queried directly (Section 7.3).
- **Over-indexing risk is explicitly managed**: every index listed in Section 3 is tied to a concrete query pattern from PROJECT_REQUIREMENTS.md's user journeys or SYSTEM_ARCHITECTURE.md's module responsibilities — no speculative indexes are added "just in case," since each index has a real write-amplification cost.

---

## 7. Soft Delete Strategy

### 7.1 `deleted_at` Mechanics

Soft-deletable tables (identified in 1.6: `Customer`, `Employee`, `Service`, `Category`, `Appointment`) carry `deleted_at` (nullable `TIMESTAMPTZ`) plus `deleted_by_type`/`deleted_by_id` (1.11). A `null` value means the row is active; a timestamp means it was soft-deleted at that instant by the recorded actor.

### 7.2 Restoration

Because deletion only sets a timestamp rather than removing data, restoration is a straightforward `deleted_at = null` update (an application-layer operation, e.g., an Owner "undoing" an accidental employee removal). No data is lost in the deletion→restoration cycle, and any records created *while* the entity was soft-deleted (which shouldn't normally happen, since deleted entities are excluded from active-record queries per 7.3) are not a concern under normal application flow.

### 7.3 Unique Constraint Handling

Every unique constraint on a soft-deletable table is a **partial unique index** scoped to `WHERE deleted_at IS NULL`, e.g., `uq_customers_tenant_phone` on `(tenant_id, phone_number) WHERE deleted_at IS NULL` (3.4.1). This is deliberate: without the partial scoping, a hard unique constraint would permanently block reusing a phone number/name/slug after the original record is soft-deleted, which is both incorrect (the "deleted" customer isn't really gone, just hidden) and would silently break legitimate re-registration scenarios (e.g., a re-added employee with the same name).

### 7.4 Query Filtering

Every read query against a soft-deletable table must, by default, filter `WHERE deleted_at IS NULL` unless explicitly querying historical/deleted records (e.g., an Admin "show deleted" view). At the Prisma layer (Section 11), this is the specific motivation for using a **Prisma Client Extension** (or middleware, depending on the Prisma version adopted in the next phase) that automatically injects this filter on every query against soft-deletable models — ensuring the safety property doesn't depend on every individual query author remembering to add it, mirroring the same "make the safe path the only path" philosophy applied to tenant scoping (Section 5.2).

---

## 8. Audit Strategy

### 8.1 `created_by` / `updated_by` / `deleted_by`

As defined in Section 1.7/1.11, every tenant-owned table uses the **actor-reference pattern** (`*_type` + `*_id`) rather than a plain `User` foreign key, because four distinct actor types legitimately mutate data in this system: `USER` (staff/owner action via the dashboard), `AI` (an autonomous booking action via WhatsApp), `SYSTEM` (a background job, e.g., auto-marking a past appointment `COMPLETED`), and `CUSTOMER` (a self-service action relayed through the AI, e.g., a WhatsApp-initiated cancellation — modeled as `CUSTOMER` rather than `AI` specifically to distinguish "the AI decided this" from "the AI merely executed the customer's explicit instruction," which matters for the dispute-resolution scenarios in PROJECT_REQUIREMENTS.md Section 17).

### 8.2 Audit Logs (`audit_logs`)

The system-of-record for **business-significant events** — every appointment creation/change/cancellation, every settings change, every subscription change, every tenant suspension. Table design in 3.10.1. This is the table that directly answers "what happened and why" for the AI-hallucination/incorrect-booking risk scenario (PROJECT_REQUIREMENTS.md Risk R2/SYSTEM_ARCHITECTURE.md Risk R2) — every AI-driven mutation is expected to write both an `AppointmentHistory` row (entity-specific, detailed before/after state) **and** an `AuditLog` row (cross-entity, queryable trail), giving two complementary views of the same event: one entity-centric (for "show me this appointment's full history" screens) and one action-centric (for "show me everything that happened to this tenant in the last 24 hours" screens).

### 8.3 Activity Logs (`activity_logs`)

The system-of-record for **high-frequency, lower-business-significance events** — logins, logouts, and (if later needed) granular API request logging. Deliberately kept out of `audit_logs` so that a support engineer or Owner reviewing "what happened to my bookings" is never scrolling past hundreds of routine login events (1.7, 3.10.2).

### 8.4 History Tables

`AppointmentHistory` (3.5.3) is the schema's one dedicated **entity-specific history table**, chosen because appointments are the single highest-stakes, most audit-sensitive entity in the system (booking correctness is a Critical NFR). Other entities (e.g., `Service` price changes, `Employee` schedule changes) are **not** given dedicated history tables at MVP — their change history, where needed, is reconstructable from `audit_logs.metadata` (which stores before/after snapshots generically). This is a deliberate scope decision: a dedicated history table per entity would be redundant with `audit_logs` for lower-stakes entities and is deferred until a concrete product need (e.g., "show price history for this service") justifies the added table.

---

## 9. Data Lifecycle

### 9.1 Customer

`created` (first inbound WhatsApp message, via `findOrCreateByPhone`, or manual staff entry) → **active** (accumulates `Appointment`, `Conversation`, `CustomerNote` history indefinitely) → optionally **soft-deleted** (Owner/Manager removes a customer record, e.g., a duplicate or a data-deletion request under compliance obligations, PROJECT_REQUIREMENTS.md Section 20) → data is retained in soft-deleted form to preserve referential integrity for historical `Appointment`/`Message` records, with a defined retention/hard-purge policy (an operational, not schema, decision) for genuine "right to be forgotten" requests, which would require a documented hard-delete/anonymization procedure distinct from the standard soft-delete (flagged in Section 13 as a compliance-driven exception to the general soft-delete philosophy).

### 9.2 Appointment

`created` (`PENDING` or directly `CONFIRMED`, by AI or staff) → **confirmed** → one of: **completed** (past `end_time`, marked by a scheduled job or staff action), **cancelled** (by customer via AI, or staff, subject to `cancellation_notice_hours` policy), **no-show** (staff-marked after the fact), or **rescheduled** (which creates a new `Appointment` row linked via `rescheduled_from_appointment_id`, while the original is marked `RESCHEDULED`/cancelled — preserving both as distinct historical records rather than mutating start/end times in place, so `AppointmentHistory` accurately reflects "this booking became that booking" rather than silently overwriting the original). Every transition writes an `AppointmentHistory` row.

### 9.3 Conversation

`created` (first inbound message from a new or returning customer thread) → **AI-handled** (`OPEN_AI`, default state) → optionally **escalated** (`ESCALATED` → `HUMAN_HANDLING`, per SYSTEM_ARCHITECTURE.md 5.8) → **resolved/closed** (`RESOLVED` then `CLOSED`, either explicitly by staff or after a period of inactivity via a scheduled job — exact inactivity threshold is a `TenantSettings`-configurable or platform-default value, a product decision for the next phase). A `CLOSED` conversation is not deleted — `Message` history is retained per the audit/compliance requirement — but a new inbound message from the same customer after closure opens a **new** `Conversation` row rather than reopening the old one (5.6.1 business rule).

### 9.4 Subscription

`created` (`TRIALING`, at tenant sign-up) → **active** (on successful first payment, or immediately if no payment method required during trial) → cycles through **active** ↔ **past_due** (on payment failure, triggering the dunning flow, FR-25) → either recovers to **active** or progresses to **canceled** (after exhausting dunning retries, or explicit cancellation) → tenant's `status` (3.2.1) is kept in sync with `subscription.status` by application logic reacting to Stripe webhooks, per the state mapping implied in PROJECT_REQUIREMENTS.md Section 15 (Business Rule 10) and Section 14.6 (Subscription Lifecycle Journey).

### 9.5 Employee

`created` (Owner/Manager adds staff) → **active** (schedulable, appears in availability computation) → optionally **on_leave** (temporarily excluded from new bookings without losing configuration/history) → optionally **inactive**/**soft-deleted** (departed staff member) — existing `Appointment` and `AppointmentHistory` rows referencing the employee are never affected by this transition, preserving historical accuracy of past bookings even after the staff member leaves.

### 9.6 Files (and Media)

`created` (uploaded via dashboard, or downloaded from WhatsApp's media API per SYSTEM_ARCHITECTURE.md 6.8) → **referenced** (linked from `Tenant.logo_file_id`, `Message.media_id`, `Invoice.invoice_pdf_file_id`, etc.) → retained indefinitely at MVP, with a future scheduled cleanup job (flagged, not built at MVP) to purge orphaned `Media`/`File` rows whose owning record has been hard-deleted or whose retention window (particularly for WhatsApp media, which may carry lighter long-term business value than, e.g., invoices) has lapsed — an operational/cost concern (S3 storage cost) more than a correctness one.

### 9.7 Messages

`created` (immutable, on inbound receipt or outbound send confirmation) → `status` transitions (`QUEUED` → `SENT` → `DELIVERED` → `READ`, or → `FAILED`) driven by WhatsApp delivery-receipt webhooks → retained indefinitely as the durable conversation record (never deleted, per the audit-trail requirement) → the primary lifecycle concern for this table is **not** deletion but **volume management** at scale — addressed via partitioning/archival strategy in Section 12, not via any deletion policy, since message history has ongoing business and potential legal/compliance value (PROJECT_REQUIREMENTS.md Section 20).

---

## 10. Redis Design

Redis's role spans several concerns (SYSTEM_ARCHITECTURE.md Section 11.3); this section specifies the concrete data structures and key patterns for each, all namespaced by prefix to keep concerns logically separated despite sharing one Redis instance at MVP scale.

### 10.1 Session Cache

- **Key pattern:** `session:refresh:{tokenHash}` → session metadata (userId, tenantId, expiry) — a fast-path existence/validity check layered in front of the `user_sessions` table for high-frequency refresh calls, with the Postgres table remaining the durable source of truth for revocation/audit.
- **Structure:** String (JSON) or Hash. **TTL:** matches refresh token expiry (auto-expires, no manual cleanup needed for the cache layer itself).

### 10.2 AI Memory Cache

- **Key pattern:** `ai:context:{conversationId}` → cached, fast-access copy of the current `AIContext.state` and a bounded recent-message window, avoiding a Postgres round-trip on every AI turn (SYSTEM_ARCHITECTURE.md 5.2, 5.7).
- **Structure:** Hash or JSON string. **TTL:** short-to-moderate (e.g., a few hours of inactivity), refreshed on every turn; the durable `ai_contexts`/`messages` tables are unaffected by cache expiry — this is purely a latency optimization, never the source of truth.
- **Key pattern:** `ai:tenant-config:{tenantId}` → cached `TenantSettings` + active `Service`/`Employee` catalog summary, invalidated explicitly on write (Section 6.5 note) rather than relying purely on TTL, since stale service/pricing data directly risks an AI hallucination-adjacent error (quoting an outdated price).

### 10.3 Rate Limits

- **Key pattern:** `ratelimit:login:{ip}` / `ratelimit:api:{userId}` / `ratelimit:tenant-messages:{tenantId}:{periodBucket}` — sliding-window or fixed-window counters (Redis `INCR` + `EXPIRE`) backing both the security-motivated rate limiting (SYSTEM_ARCHITECTURE.md 9.2) and the plan-based usage-limit enforcement (FR-22), which are conceptually distinct but mechanically similar counters.
- **Structure:** Integer counters with `EXPIRE`. **TTL:** matches the rate-limit window (e.g., 60 seconds for login attempts, monthly-bucketed for plan usage — the monthly counter is periodically reconciled against `subscriptions.messages_used_current_period` in Postgres so Redis is an accelerator, not the sole record, for billing-relevant counts).

### 10.4 Booking Locks

- **Key pattern:** `lock:availability:{tenantId}:{employeeId}:{timeSlotBucket}` — a short-lived distributed lock (Redis `SET NX PX`) acquired before the availability-check-then-create sequence for a given employee/time-window, preventing a race condition where two near-simultaneous booking attempts (e.g., the AI processing two rapid customer messages, or an AI booking racing a manual staff booking) both pass the availability check before either commits.
- **Structure:** Simple key with a short TTL (e.g., a few seconds — just long enough to cover the check-then-create transaction) and a unique lock-holder value to guard against a lock being released by the wrong holder. This is a **complement to**, not a replacement for, the database-transaction-level conflict prevention described in 3.5.1 — the lock avoids wasted work/contention under concurrent load, while the transaction/constraint layer remains the actual correctness guarantee.

### 10.5 OTP (Future 2FA)

- **Key pattern:** `otp:{userId}` → the current one-time code, if/when 2FA (SYSTEM_ARCHITECTURE.md 7.8) is activated for a tenant/user.
- **Structure:** String. **TTL:** short (e.g., 5 minutes), matching standard OTP expiry conventions. Not implemented at MVP; reserved pattern.

### 10.6 Temporary Tokens

- Durable, auditable tokens (password reset, email verification) are stored in **Postgres**, not Redis (Section 3.1.6/3.1.7), since they carry audit/traceability value and a moderate lifetime. Redis is reserved for genuinely ephemeral, high-churn tokens where Postgres durability isn't needed — at MVP, this is primarily the OTP pattern above; no other "temporary token" category is currently identified as Redis-appropriate.

### 10.7 Webhook Deduplication

- **Key pattern:** `dedup:whatsapp:{whatsappMessageId}` / `dedup:stripe:{providerEventId}` — a fast existence-check layer in front of the database-level unique constraints (3.6.2, 3.7.2, 3.10.5), letting the webhook controller short-circuit an obvious duplicate before even attempting a database write, reducing load under Meta's/Stripe's at-least-once retry behavior.
- **Structure:** Simple key existence flag (`SET NX EX`). **TTL:** set generously beyond the provider's expected retry window (e.g., 24–48 hours) — after expiry, the **database unique constraint remains the authoritative dedup guarantee** (Section 6.6/SYSTEM_ARCHITECTURE.md 6.6), so Redis expiry never risks an actual duplicate being processed, only a slightly less efficient duplicate-rejection path for very late retries.

---

## 11. Prisma Design

### 11.1 Model Organization

- Prisma models are organized to mirror the domain groupings in Section 2/SYSTEM_ARCHITECTURE.md Section 3 (Authentication, Tenant, Salon, Customer, Appointments, Conversations, WhatsApp, Billing, Notifications, System) — either via Prisma's multi-file schema support (splitting `schema.prisma` into domain-grouped files under a shared `prisma/schema/` directory, keeping the single logical schema physically organized) or, if the adopted Prisma version doesn't support that cleanly, via clear commented section headers within one file, in the same order as this document, so the schema and this document stay easy to cross-reference.
- Each Prisma model directly corresponds to one table in Section 3; junction tables (`EmployeeService`, `AppointmentService`, `CustomerTagAssignment`, `RolePermission`) are modeled as explicit models (not Prisma's implicit many-to-many) specifically because every one of them carries additional columns (snapshot fields, `tenant_id`, timestamps) beyond the two foreign keys — Prisma's implicit-relation-table shorthand only fits a bare junction, which none of these are.

### 11.2 Enums

Every enum identified in Section 3 (`ActorType`, `TenantStatus`, `SubscriptionStatus`, `AppointmentStatus`, `ConversationStatus`, `MessageDirection`, `MessageSenderType`, `MessageType`, `MessageStatus`, `EmployeeStatus`, `NotificationChannel`, `NotificationStatus`, `InvoiceStatus`, `PaymentStatus`, `FileOwnerType`) is modeled as a native Prisma `enum`, mapping to a native PostgreSQL enum type — chosen over plain string/VARCHAR columns for these because their value sets are small, stable, and application-logic-critical (exhaustive `switch`-style handling in the backend benefits directly from compile-time enum checking). The one deliberate exception is `AuditLog.action` (Section 3.10.1), kept as a documented `VARCHAR` rather than an enum, because that value set is expected to grow frequently as new auditable actions are added across modules, and a native Postgres enum requires a migration for every new value — an unnecessary friction point for a field that's queried/filtered but never exhaustively branched on in application logic.

### 11.3 Relations

- Every foreign key in Section 3 becomes a Prisma `@relation`, with explicit `onDelete`/`onUpdate` behavior chosen per relationship's business meaning rather than a blanket default: **soft-delete-protected relations** (e.g., `Appointment.customerId` → `Customer`) use `onDelete: Restrict` at the database level (since the application never hard-deletes these rows — a `Restrict` makes an accidental hard-delete attempt fail loudly rather than cascade silently); genuinely dependent child records (e.g., `AppointmentService` rows when their parent `Appointment` is hard-deleted, if that ever legitimately happens in a data-cleanup context) use `onDelete: Cascade`.
- The composite-foreign-key pattern flagged in Section 5.3 for cross-tenant-safe relations (e.g., `Appointment` → `Employee` both sharing `tenant_id`) is noted here as a specific Prisma modeling decision to resolve in the next phase — Prisma supports multi-field relations, so this is achievable, but requires deciding whether every tenant-owned table exposes a compound unique `(tenant_id, id)` specifically to support it, which is a schema-design tradeoff (extra unique index per table) to be made explicitly when writing `schema.prisma`, not assumed silently.

### 11.4 Indexes

Every index specified in Section 3/6 becomes a Prisma `@@index` or `@@unique` (including partial/filtered unique constraints via Prisma's support for it, or a raw SQL migration escape hatch where Prisma's declarative syntax doesn't yet cover a specific partial-index case — e.g., `WHERE deleted_at IS NULL` partial uniques may require a manual migration adjustment after `prisma migrate dev` generates the base migration, a known, documented Prisma limitation to plan for rather than be surprised by in the next phase).

### 11.5 Migrations

- Standard Prisma migration workflow (`prisma migrate dev` locally, `prisma migrate deploy` in CI/CD per SYSTEM_ARCHITECTURE.md Section 10.5) — every schema change is a reviewed, committed migration file, never an ad hoc production schema edit.
- **Recommended migration order** for the initial schema build-out is given in Section 14.3, respecting foreign-key dependency order (global/reference tables first, then `Tenant`, then everything that depends on it).
- Given the backward-compatible-migration discipline established in SYSTEM_ARCHITECTURE.md Section 10.11, destructive changes (column removal, type narrowing) to any table in this design follow a documented multi-step pattern (add new → dual-write/backfill → cut over → remove old) once the platform is live with real tenant data — not a concern for the initial migration set, but worth stating as a standing convention.

### 11.6 Seed Strategy

- **Required seed data** (must exist before the application can function): `roles` (4 fixed rows), `permissions` and `role_permissions` (the full permission set mapped to roles), `plans` (at least one default plan tier), and the initial `Setting` rows (e.g., default AI prompt version).
- **Development-only seed data** (for local/staging environments, never run against production): sample tenants, employees, services, and customers to support manual testing and demo environments — clearly separated (e.g., a distinct seed script/flag) from the required-seed script so a production deploy never risks accidentally seeding fake demo data.

---

## 12. Future Scaling

This schema's assumptions are stress-tested here against the concrete growth scenarios requested, tying back to SYSTEM_ARCHITECTURE.md Section 11 (Scalability Strategy) and Section 12 (Design Decisions).

### 12.1 100 Salons

Trivial load for this design. Every table fits comfortably in PostgreSQL's shared buffer cache; no partitioning, read replicas, or connection pooling beyond Prisma's default pool are needed. This stage validates correctness (tenant isolation, booking conflict prevention) more than performance.

### 12.2 1,000 Salons

Still comfortably within a single well-resourced PostgreSQL instance on the target Hetzner VPS tier. `customers` and `appointments` reach the low-hundred-thousands to low-millions of rows (depending on per-salon activity); the `(tenant_id, ...)` composite indexes (Section 6) keep per-tenant query performance flat regardless of *other* tenants' data volume — this is the specific payoff of the indexing strategy chosen in Section 6.2/6.3. Redis caching (Section 10.2) becomes meaningfully load-reducing at this stage as AI-turn volume grows.

### 12.3 10,000 Salons

This is the stage where specific, previously-flagged mitigations become necessary rather than optional:
- **Connection pooling** (SYSTEM_ARCHITECTURE.md Section 11.7) — a pooler (e.g., PgBouncer) in front of PostgreSQL becomes necessary as backend replica count and worker concurrency grow, since Postgres's own `max_connections` becomes a real ceiling.
- **Read replicas** for reporting/dashboard-aggregate queries (`Dashboard` module, Admin platform-wide analytics) become worth introducing, offloading read-heavy aggregate queries from the primary instance that's handling the booking-critical write path.
- **`messages` and `whatsapp_webhook_events` approach the range where table partitioning (12.5) shifts from "future-proofing" to "should be scheduled soon."**

### 12.4 1 Million Appointments

Directly exercised by this design's indexing strategy (Section 6.3): the `(tenant_id, employee_id, start_time)` and `(tenant_id, status, start_time)` composite indexes keep both the booking-conflict-check path and the dashboard-calendar-read path performant at this volume, because every real query is tenant-scoped and no query needs to scan across the full 1-million-row table — it scans within one tenant's slice, which remains small (thousands, not millions, of rows) even as the platform-wide total grows. This is the direct payoff of the "index every tenant-scoped filter path" principle (Section 1.8/6.2) — the schema is designed so that **platform-wide row count and per-tenant query cost are decoupled**.

### 12.5 10 Million WhatsApp Messages

This is the volume tier that most directly demands the two specific mitigations flagged throughout Section 3:
- **Time-based table partitioning** on `messages` (and similarly `whatsapp_webhook_events`, `audit_logs`, `activity_logs`, `appointment_history`) — e.g., monthly range partitions on `created_at` — keeps individual partition sizes (and their indexes) manageable, keeps vacuum/maintenance operations fast, and allows old partitions to be moved to cheaper storage or dropped entirely under a defined retention policy without an expensive `DELETE` over a monolithic table.
- **UUIDv7 primary keys** (Section 1.5) on exactly these tables were chosen specifically in anticipation of this scale — a UUIDv4 PK on a 10-million-row, constantly-inserting table would cause severe B-tree index bloat/fragmentation that UUIDv7's time-ordering avoids.
- **Archival strategy**: `whatsapp_webhook_events` (the rawest, least business-valuable of the message-adjacent tables, 3.7.2) is the first candidate for aggressive archival/deletion after a short retention window (e.g., 90 days), since its processed content is already durably captured in `messages`; `messages` itself is retained far longer given its ongoing business/compliance value (Section 9.7), with partitioning (not deletion) as the primary scaling lever.

---

## 13. Risks

| # | Risk | Bottleneck / Failure Mode | Mitigation |
|---|---|---|---|
| DB-R1 | Cross-tenant FK integrity gap (Section 5.3) — PostgreSQL cannot natively enforce "these two FK'd rows share the same `tenant_id`" without composite FKs, which add index/storage overhead on every tenant-owned table | A bug could create an `Appointment` referencing an `Employee` from a *different* tenant, silently corrupting isolation at the data layer even if the application-layer guard is bypassed | Adopt composite foreign keys `(tenant_id, id)` for the highest-risk relations (`Appointment` ↔ `Employee`/`Customer`/`Service`) in the Prisma schema phase (11.3); backstop with integration tests asserting rejection; RLS (5.7) as a further backstop once justified |
| DB-R2 | `messages` / `whatsapp_webhook_events` / `audit_logs` / `activity_logs` unbounded growth | Query performance degradation, bloated indexes, slow backups/vacuum on a single self-managed Postgres instance (no managed auto-scaling, per SYSTEM_ARCHITECTURE.md's fixed infra) | Time-based partitioning + defined retention/archival policy (Section 12.5), scheduled well before the 10,000-salon tier is reached, not reactively |
| DB-R3 | Booking race conditions under concurrent load (two near-simultaneous booking attempts for the same employee/slot) | A subtle timing gap between availability-check and appointment-creation could theoretically allow a double-booking despite the application-layer transaction, especially under high concurrency | Redis distributed lock (10.4) as a first line of defense against contention; the actual correctness guarantee still needs to be a database-transaction-level check (a `SELECT ... FOR UPDATE` on the relevant time-window rows, or the `btree_gist` `EXCLUDE` constraint option flagged in 3.5.1) — this specific mechanism must be finalized and load-tested in the Prisma/migration phase, not assumed solved by this document alone |
| DB-R4 | JSONB overuse/misuse (`AIContext.state`, `AuditLog.metadata`, webhook `payload` columns) | Unbounded, unvalidated JSONB growth can bloat row/table size and make querying inconsistent if application code doesn't enforce a stable shape | JSONB is scoped deliberately (1.4/1.11) to genuinely flexible/evolving data only — never used as a substitute for proper relational columns on core business entities; application-layer schema validation (e.g., a TypeScript type/Zod schema per JSONB field) is a cross-referenced requirement for the next (application) phase |
| DB-R5 | Connection pool exhaustion as backend replica count grows (SYSTEM_ARCHITECTURE.md 11.1/11.7) | Prisma's per-instance connection pool × replica count can exceed PostgreSQL's `max_connections` well before the 10,000-salon tier if unaddressed | PgBouncer (or equivalent) introduction is pre-scheduled at the 10,000-salon tier (12.3), not left as a reactive fire-drill |
| DB-R6 | Soft-delete query-filtering omission (Section 7.4) | A hand-written query against a soft-deletable table that forgets `WHERE deleted_at IS NULL` surfaces "deleted" data to users, or a partial-unique-index assumption is violated by a raw query bypassing Prisma | Prisma Client Extension/middleware enforcing the filter automatically (7.4) is a required, not optional, part of the application-layer implementation — flagged explicitly for the next phase's architecture, not left as a per-developer discipline issue |
| DB-R7 | Compliance-driven hard deletion (a genuine "right to be forgotten" request) conflicts with the schema's default soft-delete/retain-forever philosophy (9.1) | An inability to fully purge a customer's data on request is a compliance risk (PROJECT_REQUIREMENTS.md Section 20) | A documented, distinct hard-delete/anonymization procedure (overwriting PII fields while preserving anonymized referential/aggregate history) needs to be designed as an explicit operational runbook, not conflated with the standard soft-delete flow — flagged for a follow-up design note, out of this document's core scope |
| DB-R8 | Denormalized fields drifting from source of truth (`appointment.total_price_cents`, `conversation.last_message_at`, `conversation_summaries`) | A bug in the update path could leave a denormalized field stale, showing incorrect totals/ordering | Every denormalized field's owning write-path is documented at its table definition (Section 3) specifically so the next phase's service-layer design treats recomputation as a mandatory, transactional part of the relevant write operation, not an afterthought |

---

## 14. Deliverables

### 14.1 Complete Table List (45 Tables)

**Authentication & Access (7):** `users`, `roles`, `permissions`, `role_permissions`, `user_sessions`, `password_reset_tokens`, `email_verification_tokens`

**Tenant (3):** `tenants`, `tenant_settings`, `tenant_invitations`

**Salon — Staff & Catalog (7):** `employees`, `categories`, `services`, `employee_services`, `working_hours`, `holidays`, `employee_availability`

**Customer (4):** `customers`, `customer_notes`, `customer_tags`, `customer_tag_assignments`

**Appointments (3):** `appointments`, `appointment_services`, `appointment_history`

**Conversations (4):** `conversations`, `messages`, `ai_contexts`, `conversation_summaries`

**WhatsApp (4):** `whatsapp_accounts`, `whatsapp_webhook_events`, `template_messages`, `media`

**Billing (5):** `plans`, `subscriptions`, `invoices`, `payments`, `coupons`

**Notifications (2):** `notifications`, `notification_logs`

**System (6):** `audit_logs`, `activity_logs`, `files`, `api_keys`, `webhook_events`, `settings`

### 14.2 Relationship Summary

- **11 one-to-one** relationships (Section 4.1), primarily separating rarely-changed identity data from frequently-mutated operational/AI state.
- **~25 one-to-many** relationships (Section 4.2) rooted overwhelmingly in `Tenant`, reflecting the multi-tenant architecture.
- **4 many-to-many** relationships (Section 4.3), each resolved via an explicit junction table (never Prisma's implicit shorthand, per 11.1), one of which (`AppointmentService`) additionally carries historical snapshot data (4.4).

### 14.3 Recommended Migration Order

Respecting foreign-key dependency order — each phase's tables depend only on tables from prior phases:

1. **Global reference data:** `roles`, `permissions`, `role_permissions`, `plans`
2. **Tenant root:** `tenants`
3. **Tenant configuration:** `tenant_settings`, `settings`
4. **Identity:** `users`, `tenant_invitations`, `user_sessions`, `password_reset_tokens`, `email_verification_tokens`
5. **Salon catalog & staff:** `categories`, `employees`, `services`, `employee_services`, `working_hours`, `holidays`, `employee_availability`
6. **Customers:** `customers`, `customer_tags`, `customer_notes`, `customer_tag_assignments`
7. **WhatsApp integration:** `whatsapp_accounts`, `whatsapp_webhook_events`, `template_messages`
8. **Files & media:** `files`, `media` *(after `tenants`/`users`; before tables that reference them, e.g. `tenants.logo_file_id` requires a deferred/nullable FK or a two-step migration since `files` also references `tenants`, a documented circular-reference resolved via a nullable FK added in a follow-up migration step)*
9. **Conversations & AI:** `conversations`, `messages`, `ai_contexts`, `conversation_summaries`
10. **Appointments:** `appointments`, `appointment_services`, `appointment_history`
11. **Billing:** `subscriptions`, `invoices`, `payments`, `coupons`
12. **Notifications:** `notifications`, `notification_logs`
13. **System/audit:** `audit_logs`, `activity_logs`, `api_keys`, `webhook_events`

### 14.4 Database Conventions (Recap)

| Convention | Rule |
|---|---|
| Primary keys | UUID; UUIDv7 for high-write time-ordered tables, UUIDv4 elsewhere (1.5) |
| Multi-tenancy | Shared schema, `tenant_id` discriminator on every tenant-owned table, indexed and RLS-compatible (Section 5) |
| Soft deletes | `deleted_at` + actor fields on business-record tables only; partial unique indexes scoped to active rows (Section 7) |
| Auditing | Actor-reference pattern (`*_type`/`*_id`) supporting `USER`/`AI`/`SYSTEM`/`CUSTOMER`; dual-layer trail via `audit_logs` (cross-entity) and `appointment_history` (entity-specific) (Section 8) |
| Timestamps | `TIMESTAMPTZ` everywhere, UTC storage, tenant-local display is an application concern (1.9) |
| Money | Integer minor units (`*_cents`) + ISO 4217 `currency` — never floating point |
| Naming | `snake_case` tables/columns, `PascalCase` Prisma models, `camelCase` Prisma fields (1.10) |
| JSONB | Reserved for genuinely flexible/evolving data only, never a substitute for relational modeling of core entities (1.4/13) |

---

## Document Status & Next Steps

This document defines **database design only** — no Prisma schema file, no SQL DDL, and no ORM/application code have been produced, per instruction.

**Key decisions made in this phase requiring explicit sign-off before proceeding:**
1. 45-table schema organized across 10 domains, with soft-deletes limited to five core business-record tables (1.6).
2. UUIDv7 for high-write, time-ordered tables; UUIDv4 elsewhere (1.5).
3. Actor-reference pattern (`USER`/`AI`/`SYSTEM`/`CUSTOMER`) for all audit fields, not a plain `User` foreign key (1.7/8.1).
4. Shared-schema multi-tenancy with `tenant_id` on every tenant-owned table, RLS-compatible but not RLS-enabled at MVP (Section 5).
5. Historical snapshotting on `AppointmentService` to protect booking history from catalog-price drift (4.4).
6. Time-based partitioning and archival flagged as required (not optional) once the platform approaches the 10,000-salon / 10-million-message tier (Section 12.5), not built at initial launch.
7. The cross-tenant FK integrity gap (DB-R1) and the booking-race-condition mechanism (DB-R3) are flagged as open technical decisions to finalize during Prisma schema authoring, not silently resolved by this document.

**Recommended next step:** Generate the **Prisma schema** (`schema.prisma`) implementing this design exactly — models, enums, relations, indexes, and migration files — once this document is approved.

**Awaiting your approval before proceeding.**
