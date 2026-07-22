# AUTH_SCHEMA_REVIEW.md

## Sprint 2.1 — Identity Foundation

**Document Status:** Draft for Approval
**Date:** 2026-07-21
**Depends on:** PRISMA_SCHEMA.md, DATABASE_DESIGN.md, SYSTEM_ARCHITECTURE.md §7–8, IMPLEMENTATION_ROADMAP.md (Milestone 2/3)
**Scope:** Prisma schema only — which models/fields/enums to add and why, and one sequencing decision they depend on. No NestJS code, no migrations generated, no login/JWT/OAuth/password-hashing logic. That is Sprint 2.1's actual implementation sprint per IMPLEMENTATION_ROADMAP.md, not this review.

---

## 1. Current State

`backend/prisma/schema.prisma` contains exactly Milestone 1's global-reference-data batch (ADR-001 decision 4, PRISMA_SCHEMA.md §14.2 step 1):

- `Role`, `Permission`, `RolePermission`, `Plan`
- `RoleName` enum
- No `User`, no `Tenant`, no auth tables, no `ActorType`/`TenantStatus` enums exist yet.

This matches every prior document exactly — ARCHITECTURE_REVIEW.md already confirmed no undocumented drift after Milestone 1. Nothing below is a correction of past work; it's the next incremental batch.

---

## 2. What This Sprint Needs to Add

PRISMA_SCHEMA.md §3 ("Authentication Models") fully designs `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken`, `EmailVerification`, `PasswordReset`. `Role`/`Permission`/`RolePermission` already exist. This sprint's gap is:

| Item | Status |
|---|---|
| `ActorType` enum | Missing — required by `User.deletedByType` |
| `User` | Missing |
| `UserRole` | Missing |
| `RefreshToken` | Missing |
| `EmailVerification` | Missing |
| `PasswordReset` | Missing |

---

## 3. The Sequencing Issue Found (Resolved — see decision below)

`User.tenantId` is a real `@relation` to `Tenant` (nullable — null only for `SUPER_ADMIN`). `TenantInvitation` (Section 4 of PRISMA_SCHEMA.md, needed by Sprint 2.2's "close the invitation-acceptance gap" task) has a **non-nullable** FK to `Tenant`.

`Tenant` itself does not exist yet — IMPLEMENTATION_ROADMAP.md's Backend Module Order table assigns it to Milestone 3, Sprint 3.1, *after* Milestone 2's Auth sprints. But PRISMA_SCHEMA.md §14.2's own recommended migration order puts **Tenant (step 2) before Identity (step 4)** — this schema document already anticipated that Identity depends on Tenant existing. Left unresolved, this would silently block Sprint 2.2, which needs `TenantInvitation` to implement `POST /auth/accept-invitation` before Milestone 3's `Tenants` module is scheduled to exist.

**Decision (approved):** Add a minimal `Tenant` table now, in this sprint's migration — schema only, no service/controller/business logic. Milestone 3, Sprint 3.1 proceeds as planned, adding `TenantSettings`, `TenantFeature`, the `Tenants` module's actual application code, and the atomic register-provisions-a-tenant transaction, on top of a table that already exists rather than building it from scratch. This matches PRISMA_SCHEMA.md's own documented dependency order and unblocks Sprint 2.2 without requiring that roadmap sprint to be rewritten.

This is a real, logged deviation from the roadmap's literal module-ownership table (Tenant "belongs to" Sprint 3.1) and should be recorded as an ADR once this document is approved (Section 7).

---

## 4. Incremental-Model Pattern (Precedent Already Set in Milestone 1)

`Role` in the current schema has no `users User[]` back-relation — because `User` didn't exist yet when `Role` was added. That precedent applies identically here: **every model added this sprint includes only the relations to models that already exist (or are added in this same batch)**. Relations to models from later milestones are added when those milestones introduce them, as a small, additive migration on the *existing* model — never a speculative forward reference.

Concretely, the fully-documented `User` model in PRISMA_SCHEMA.md §3 has back-relations to `Employee`, `AuditLog`, `ActivityLog`, `CustomerNote`, `Conversation`, `Message`, `File`, `Notification`, `APIKey` — none of which exist yet. All of these are **deferred**, added to `User` in the migration batch of the milestone that introduces the other side (Milestone 4, 6, 9 respectively per the roadmap). This is not a scope reduction of the design — it's the same incremental-application pattern ADR-001 decision 4 already established, applied to `User` instead of `Role`.

---

## 5. Proposed Schema (This Sprint's Batch)

### 5.1 New Enums

```prisma
enum ActorType {
  USER
  AI
  SYSTEM
  CUSTOMER
}

enum TenantStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELLED
}
```

### 5.2 `Tenant` (minimal — schema only, per Section 3's decision)

```prisma
model Tenant {
  id            String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name          String       @db.VarChar(255)
  slug          String       @unique @db.VarChar(100)
  status        TenantStatus @default(TRIAL)
  timezone      String       @default("UTC") @db.VarChar(50)
  addressLine1  String?      @db.VarChar(255)
  addressLine2  String?      @db.VarChar(255)
  city          String?      @db.VarChar(100)
  countryCode   String?      @db.Char(2)
  defaultLocale String       @default("en") @db.VarChar(10)
  trialEndsAt   DateTime?
  suspendedAt   DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  deletedAt     DateTime?

  users       User[]
  invitations TenantInvitation[]

  @@index([status], name: "idx_tenants_status")
  @@map("tenants")
}
```

*Deferred from the full PRISMA_SCHEMA.md §4 design:* `logoFileId`/`logoFile` (needs `File`, Milestone 4 — PRISMA_SCHEMA.md §14.2 step 8 already documents this exact deferral for the same circular-reference reason), and every other back-relation (`settings`, `features`, `employees`, `services`, `customers`, `appointments`, `conversations`, `whatsappAccount`, `subscription`, `invoices`, `payments`, `notifications`, `auditLogs`, `activityLogs`, `files`, `apiKeys`) — added when their owning milestone lands. `TenantSettings`/`TenantFeature` remain Milestone 3 scope, per the approved decision.

### 5.3 `User`

```prisma
model User {
  id               String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId         String?    @db.Uuid
  email            String     @unique @db.VarChar(255)
  passwordHash     String?    @db.VarChar(255)
  firstName        String     @db.VarChar(100)
  lastName         String     @db.VarChar(100)
  googleId         String?    @unique @db.VarChar(255)
  isEmailVerified  Boolean    @default(false)
  isActive         Boolean    @default(true)
  lastLoginAt      DateTime?
  twoFactorEnabled Boolean    @default(false)
  twoFactorSecret  String?    @db.VarChar(255)
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  deletedAt        DateTime?
  deletedByType    ActorType?
  deletedById      String?    @db.Uuid

  tenant             Tenant?             @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  roles              UserRole[]
  sessions           RefreshToken[]
  passwordResets     PasswordReset[]
  emailVerifications EmailVerification[]
  invitationsSent    TenantInvitation[]  @relation("InvitedBy")

  @@index([tenantId], name: "idx_users_tenant_id")
  @@map("users")
}
```

*Deferred:* `employee` (M4), `auditLogs` (M9), `activityLogs` (M9), `customerNotesAuthored` (M4), `assignedConversations` (M6), `messagesSent` (M6), `filesUploaded` (M4), `notifications` (M9), `apiKeysCreated` (M9/system).

### 5.4 `UserRole`

```prisma
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
```

`Role` gains its `users UserRole[]` back-relation in this same batch (the Section 4 pattern applied to `Role` itself, now that `UserRole` exists).

### 5.5 `RefreshToken`, `EmailVerification`, `PasswordReset`

As fully specified in PRISMA_SCHEMA.md §3 — no trimming needed; their only relation is to `User`, which is added in this same batch:

```prisma
model RefreshToken {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String?   @db.Uuid
  userId              String    @db.Uuid
  refreshTokenHash    String    @unique @db.VarChar(255)
  userAgent           String?   @db.VarChar(255)
  ipAddress           String?   @db.VarChar(45)
  expiresAt           DateTime
  revokedAt           DateTime?
  replacedBySessionId String?   @db.Uuid
  createdAt           DateTime  @default(now())

  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  replacedBySession RefreshToken? @relation("TokenRotation", fields: [replacedBySessionId], references: [id])
  rotatedFrom       RefreshToken[] @relation("TokenRotation")

  @@index([userId], name: "idx_refresh_tokens_user_id")
  @@index([expiresAt], name: "idx_refresh_tokens_expires_at")
  @@map("refresh_tokens")
}

model EmailVerification {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String?   @db.Uuid
  userId     String    @db.Uuid
  tokenHash  String    @unique @db.VarChar(255)
  expiresAt  DateTime
  verifiedAt DateTime?
  createdAt  DateTime  @default(now())

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

*Note:* their `tenantId` is a plain scalar column (mirrors the user's tenant for direct scoping/indexing per DATABASE_DESIGN.md §3.1.5) — PRISMA_SCHEMA.md never declares a `@relation` on it, so it carries no FK dependency on `Tenant` and needs no special handling either way.

### 5.6 `TenantInvitation` (unblocked by the Section 3 decision)

```prisma
model TenantInvitation {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String    @db.Uuid
  email           String    @db.VarChar(255)
  roleId          String    @db.Uuid
  invitedByUserId String    @db.Uuid
  tokenHash       String    @unique @db.VarChar(255)
  expiresAt       DateTime
  acceptedAt      DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  role      Role   @relation(fields: [roleId], references: [id], onDelete: Restrict)
  invitedBy User   @relation("InvitedBy", fields: [invitedByUserId], references: [id], onDelete: Restrict)

  @@index([tenantId], name: "idx_tenant_invitations_tenant_id")
  @@index([email], name: "idx_tenant_invitations_email")
  @@map("tenant_invitations")
}
```

`Role` gains `invitations TenantInvitation[]` in this same batch.

**Manual migration note (PRISMA_SCHEMA.md §14.4, carried forward, not applied yet):** the partial unique index on `(tenantId, email)` scoped to pending invitations (`WHERE acceptedAt IS NULL AND revokedAt IS NULL`) is a documented manual SQL edit to the generated migration, applied when migrations are actually generated — not something to hand-edit into this review.

---

## 6. Explicitly Out of Scope for This Sprint

Per the sprint goal: no `AuthModule`, no `UsersModule`, no controllers/services/DTOs, no JWT strategy, no password hashing (argon2/bcrypt), no Google OAuth client code, no rate limiting, no seed-data changes (`seed.ts` continues to populate only `Role`/`Permission`/`Plan` — no `User`/`Tenant` rows are seeded here). All of that is the actual Sprint 2.1 implementation sprint per IMPLEMENTATION_ROADMAP.md §4, which this review precedes.

---

## 7. What Happens on Approval

1. `docs/DECISIONS.md` gets a new ADR entry recording the Tenant-forward decision (Section 3) as a logged deviation from the roadmap's literal module-ownership table.
2. `prisma migrate dev --create-only` generates the migration for the models in Section 5; no manual SQL edits are needed at this stage (Section 5.6's partial-unique-index note is the only §14.4 item this batch touches, and it's a follow-up hand-edit at generation time, not a design change).
3. Migration is reviewed, then applied.
4. `docs/PRISMA_SCHEMA.md`'s own status is unaffected (it already documents the target design correctly) — no change needed there.

**Awaiting your approval before generating any migration.**
