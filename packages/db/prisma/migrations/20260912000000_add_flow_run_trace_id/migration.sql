ALTER TABLE "FlowRun" ADD COLUMN "traceId" TEXT;

CREATE INDEX "FlowRun_traceId_idx" ON "FlowRun"("traceId");
