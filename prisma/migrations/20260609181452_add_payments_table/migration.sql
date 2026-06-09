-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT,
    "mpPaymentId" TEXT,
    "mpPreferenceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusDetail" TEXT,
    "transactionAmount" DECIMAL(15,2) NOT NULL,
    "refundedAmount" DECIMAL(15,2) DEFAULT 0,
    "netReceivedAmount" DECIMAL(15,2),
    "paymentMethodId" TEXT,
    "paymentTypeId" TEXT,
    "installments" INTEGER DEFAULT 1,
    "description" TEXT,
    "payerEmail" TEXT,
    "payerName" TEXT,
    "payerDocument" TEXT,
    "billingCycle" TEXT,
    "paidAt" TIMESTAMP(3),
    "mpRawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_mpPaymentId_key" ON "payments"("mpPaymentId");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_idx" ON "payments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payments_tenantId_paidAt_idx" ON "payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_createdAt_idx" ON "payments"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
