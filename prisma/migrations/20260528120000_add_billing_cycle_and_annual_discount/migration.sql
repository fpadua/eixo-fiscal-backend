-- AlterTable
ALTER TABLE "plans" ADD COLUMN "descontoAnualPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'monthly';
