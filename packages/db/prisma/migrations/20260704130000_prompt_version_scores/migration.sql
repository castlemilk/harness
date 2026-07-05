-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "promptVersionId" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_promptVersionId_idx" ON "AgentRun"("promptVersionId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PromptVersion" ADD COLUMN "planningPrompt" TEXT,
ADD COLUMN "skillContext" TEXT,
ADD COLUMN "benchmarkScore" DOUBLE PRECISION;
