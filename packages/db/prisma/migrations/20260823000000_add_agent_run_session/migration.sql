-- AlterTable
-- Nullable and intentionally unbackfilled: historical runs did not expose a
-- resumable CLI session identity.
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "sessionKind" TEXT;
