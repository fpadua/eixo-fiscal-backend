-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT 'Rascunho',
    "formData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drafts_tenantId_idx" ON "drafts"("tenantId");

-- CreateIndex
CREATE INDEX "drafts_tenantId_createdAt_idx" ON "drafts"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
