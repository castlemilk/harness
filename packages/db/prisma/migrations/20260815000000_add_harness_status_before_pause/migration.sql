-- Preserve each harness's state while it is paused so resume can restore it.
ALTER TABLE "Harness" ADD COLUMN "statusBeforePause" TEXT;

-- Keep daily spend aggregates and bounded SSE pulse windows index-backed.
CREATE INDEX "Pulse_harnessId_startedAt_idx" ON "Pulse"("harnessId", "startedAt" DESC);
