-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "permissoes" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "tenant_settings" ALTER COLUMN "nfseVersion" SET DEFAULT 'v2';
