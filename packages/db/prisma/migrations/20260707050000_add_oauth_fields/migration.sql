-- Add OAuth credential fields to ProviderConfig
ALTER TABLE "ProviderConfig" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "ProviderConfig" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
