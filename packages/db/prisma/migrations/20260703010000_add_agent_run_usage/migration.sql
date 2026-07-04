-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "completionTokens" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "totalTokens" INTEGER;
