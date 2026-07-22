# ADR-002: Authentication Schema (Identity Foundation)

**Status:** Accepted
**Date:** 2026-07-21
**Milestone:** 2 — Authentication, Sprint 2.1.1 (Identity Foundation — schema only)
**Related:** docs/AUTH_SCHEMA_REVIEW.md, docs/DECISIONS.md ADR-001 decision 4, docs/PRISMA_SCHEMA.md §§2–4, 14.2, 14.4

---

## Decision

Add the Identity migration batch to `schema.prisma`: enums `ActorType` and `TenantStatus`; models `User`, `UserRole`, `RefreshToken`, `EmailVerification`, `PasswordReset`; and, pulled forward from Milestone 3, a **minimal, schema-only `Tenant`** and `TenantInvitation`. Applied as migration `20260721172518_add_identity_and_tenant_foundation`, with one manual SQL addition (a partial unique index on `TenantInvitation`) per PRISMA_SCHEMA.md §14.4. No `AuthModule`, no controllers/services/DTOs, no JWT, no password hashing, no OAuth client code — schema and migration only.

## Context

IMPLEMENTATION_ROADMAP.md's Backend Module Order table assigns `Tenants` to Milestone 3, Sprint 3.1, *after* Milestone 2's Auth sprints. But two things in this same batch have a hard dependency on `Tenant` existing:

1. `User.tenantId` is a real `@relation` to `Tenant` (nullable — null only for `SUPER_ADMIN`).
2. `TenantInvitation` (needed by Sprint 2.2's "close the invitation-acceptance gap" task, `POST /auth/accept-invitation`) has a non-nullable FK to `Tenant`.

PRISMA_SCHEMA.md §14.2's own recommended migration order already anticipated this — it places **Tenant (step 2) before Identity (step 4)** — meaning the schema design itself never assumed Auth could be built before Tenant existed, even though the roadmap's milestone-level module ownership reads that way. Left unresolved, Sprint 2.2 would have been blocked waiting on Milestone 3 for a table the schema's own dependency order says should already exist.

This was surfaced and decided during the AUTH_SCHEMA_REVIEW.md approval step (Sprint 2.1, the schema-review sprint preceding this one), not discovered mid-migration.

## Alternatives Considered

1. **Defer `TenantInvitation` to Milestone 3, keep `User.tenantId` as an unconstrained scalar column (no FK) for now.** Avoids touching `Tenant` this sprint, but leaves `User` referentially unenforced against its own tenant and pushes Sprint 2.2's invitation-acceptance task out to Milestone 3 — a roadmap rewrite this decision was specifically meant to avoid. Rejected: trades a schema inconsistency now for a scheduling inconsistency later, and doesn't actually remove the dependency, just hides it.
2. **Pull all of Milestone 3, Sprint 3.1 forward** (`Tenant`, `TenantSettings`, `TenantFeature`, `TenantInvitation`, plus the `Tenants` module's service/controller logic and the atomic register-provisions-a-tenant transaction). Resolves the dependency cleanly but merges two milestones' scope into one sprint, contradicting the incremental, reviewable-batch approach this project has followed since Milestone 1. Rejected as disproportionate to what this sprint actually needs.
3. **Minimal `Tenant` table now; full `Tenants` module business logic stays in Milestone 3 (chosen).** Matches PRISMA_SCHEMA.md's own migration order, unblocks Sprint 2.2 without rewriting it, and keeps the change small — only the columns and relations Identity actually needs, nothing else. `TenantSettings`/`TenantFeature` and all other `Tenant` back-relations (`settings`, `features`, `employees`, `services`, `subscription`, etc.) remain deferred to their owning milestones, following the same incremental-relation pattern ADR-001 decision 4 already established for `Role` in Milestone 1.

## Consequences

- Milestone 3, Sprint 3.1 now builds the `Tenants` module (controllers, services, `TenantSettings`, `TenantFeature`, the atomic registration transaction) on top of a `Tenant` table that already exists, rather than creating it from scratch — a smaller Sprint 3.1 than originally scoped, not a larger one.
- IMPLEMENTATION_ROADMAP.md's Backend Module Order table (§5) is now slightly inaccurate — it lists `Tenant` under Sprint 3.1 — and should be annotated or corrected the next time that document is revised, to note the table itself landed in Sprint 2.1.1 while the module's business logic remains Sprint 3.1's.
- `RefreshToken.replacedBySessionId` (self-referential rotation-chain pointer) now carries an explicit `onDelete: SetNull`, added during the final consistency review before this migration was generated — the prior source design (PRISMA_SCHEMA.md §3) left this relation's delete behavior to Prisma's implicit default. Made explicit here with no behavior change, since `SetNull` was already the correct implicit choice (an `expiresAt`-driven cleanup job pruning a replacement row must not be blocked by the row it replaced still pointing at it).
- The `TenantInvitation(tenantId, email)` partial unique index (`WHERE acceptedAt IS NULL AND revokedAt IS NULL`) exists only as hand-written SQL in the migration file, per PRISMA_SCHEMA.md §14.4 — it is not represented in `schema.prisma` and will not be regenerated or protected by a future `prisma migrate dev` diff. Any future migration touching `tenant_invitations` must preserve it by hand.
- Every relation from `User`/`Role`/`Tenant` to a model that doesn't exist yet (`Employee`, `AuditLog`, `ActivityLog`, `CustomerNote`, `Conversation`, `Message`, `File`, `Notification`, `APIKey`, `TenantSettings`, `TenantFeature`, and the rest of `Tenant`'s eventual fan-out) is deferred, to be added as a small additive migration on the *existing* model when the owning milestone introduces the other side — consistent with how `Role` in Milestone 1 didn't yet declare its `users`/`invitations` back-relations until this sprint added them.

## Future Evolution

- Milestone 3, Sprint 3.1 adds `TenantSettings`, `TenantFeature`, and `Tenant`'s remaining scalar/relation fields (`logoFileId` deferred further still, to a `Files` module, per PRISMA_SCHEMA.md §14.2 step 8's documented circular-reference resolution) without altering anything this migration created.
- Milestone 4 (`Employees`, `Customers`, `Files`) adds `User.employee`, `User.customerNotesAuthored`, `User.filesUploaded`, and `Tenant.employees`/`customers`/`files`, etc.
- Milestone 6 (`WhatsApp`/`Conversations`) adds `User.assignedConversations`, `User.messagesSent`, `Tenant.whatsappAccount`/`conversations`.
- Milestone 8 (`Billing`) adds `Tenant.subscription`/`invoices`/`payments`.
- Milestone 9 (`Notifications`/`Admin`/audit) adds `User.auditLogs`/`activityLogs`/`notifications`/`apiKeysCreated`, `Tenant.auditLogs`/`activityLogs`/`notifications`/`apiKeys`.
- None of the above require altering `User`, `Role`, or `Tenant`'s existing columns or constraints — only additive relation fields and their corresponding FK on the new model's side, the same low-risk pattern this ADR itself follows.

**Amended, Milestone 4 (docs/adr/ADR-007-salon-management.md):** the "Milestone 4"/"Milestone 6"/"Milestone 8"/"Milestone 9" labels above are this document's original numbering, since superseded — Milestone 4 was rescoped to the salon business-profile domain only (`SalonProfile`/`BusinessHours`/`Holiday`, no `Employees`/`Customers`/`Files`), and every milestone previously numbered 5+ cascaded up by one (`Employees`/`Customers`/`Files` → Milestone 5, `WhatsApp` → Milestone 7, `Billing` → Milestone 9, `Notifications`/`Admin` → Milestone 10). The relation additions described above are otherwise unchanged, just attached to different milestone numbers.
