-- AlterTable
ALTER TABLE "appointment_status_history" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- CreateIndex
CREATE INDEX "idx_customers_tenant_phone" ON "customers"("tenantId", "phoneNumber");
