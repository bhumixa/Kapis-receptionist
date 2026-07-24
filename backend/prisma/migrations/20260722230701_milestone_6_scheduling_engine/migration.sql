-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentHistoryAction" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'MODIFIED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "email" VARCHAR(255),
    "preferredLanguage" VARCHAR(10),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByType" "ActorType",
    "deletedById" UUID,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "totalPriceCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "cancellationReason" VARCHAR(255),
    "cancelledAt" TIMESTAMP(3),
    "rescheduledFromAppointmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByType" "ActorType",
    "deletedById" UUID,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "serviceNameSnapshot" VARCHAR(150) NOT NULL,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "bufferMinutesSnapshot" INTEGER NOT NULL DEFAULT 0,
    "sequenceOrder" SMALLINT NOT NULL DEFAULT 0,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3) NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "action" "AppointmentHistoryAction" NOT NULL,
    "previousState" JSONB,
    "newState" JSONB NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Manual edit (docs/PRISMA_SCHEMA.md Section 14.4's documented mechanism):
-- a partial unique index, not a plain one — two customer rows may
-- legitimately share a phone number once one is soft-deleted, matching the
-- Customer(tenantId, phoneNumber) constraint API_SPECIFICATION.md Section 9
-- and docs/DATABASE_DESIGN.md Section 3.4.1 already specify.
CREATE UNIQUE INDEX "uq_customers_tenant_phone" ON "customers"("tenantId", "phoneNumber") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");

-- CreateIndex
CREATE INDEX "idx_appointments_tenant_employee_start" ON "appointments"("tenantId", "employeeId", "startTime");

-- CreateIndex
CREATE INDEX "idx_appointments_tenant_customer" ON "appointments"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "idx_appointments_tenant_status_start" ON "appointments"("tenantId", "status", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenantId_id_key" ON "appointments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "idx_appointment_services_appointment_id" ON "appointment_services"("appointmentId");

-- CreateIndex
CREATE INDEX "idx_appointment_services_service_id" ON "appointment_services"("serviceId");

-- CreateIndex
CREATE INDEX "idx_appointment_services_tenant_employee_start" ON "appointment_services"("tenantId", "employeeId", "startTime");

-- CreateIndex
CREATE INDEX "idx_appointment_status_history_appointment_id" ON "appointment_status_history"("appointmentId");

-- CreateIndex
CREATE INDEX "idx_appointment_status_history_tenant_created" ON "appointment_status_history"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_rescheduledFromAppointmentId_fkey" FOREIGN KEY ("tenantId", "rescheduledFromAppointmentId") REFERENCES "appointments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "services"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual edit (docs/PRISMA_SCHEMA.md Section 14.4 "booking conflict-
-- prevention hardening", docs/adr/ADR-009-scheduling-engine.md): the
-- database-level backstop beneath the Redis lock + transactional check.
-- Scoped to "employeeId" on `appointment_services` (not `appointments`)
-- because Milestone 6 supports per-service employee assignment within one
-- visit — each line is independently blocking, not the whole appointment.
-- `tsrange`, not `tstzrange`: every DateTime column in this schema is
-- Prisma's default `TIMESTAMP(3)` (no existing migration in this codebase
-- uses `@db.Timestamptz`), so this matches the actual column type rather
-- than introducing the only timestamptz column in the database.
-- `WHERE ("isBlocking")` — only rows still representing a live hold (not a
-- cancelled/completed/superseded line, kept in sync by the application in
-- the same transaction as any Appointment status change) participate.
ALTER TABLE "appointment_services"
  ADD CONSTRAINT "excl_appointment_services_employee_time"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tsrange("startTime", "blockedUntil") WITH &&
  )
  WHERE ("isBlocking");
