-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "ambiente" TEXT NOT NULL DEFAULT 'homologacao',
ADD COLUMN     "nfseVersion" TEXT NOT NULL DEFAULT 'v1';
