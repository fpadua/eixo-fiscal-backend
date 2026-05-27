-- AlterTable
ALTER TABLE "tenant_settings" ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenantId" DROP NOT NULL;
