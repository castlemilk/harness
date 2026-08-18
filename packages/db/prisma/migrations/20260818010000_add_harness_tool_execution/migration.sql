-- Tool execution. Every column is nullable and additive: a HarnessTool with no
-- `command` behaves exactly as it did before — running it records the request
-- and executes nothing.
ALTER TABLE "HarnessTool" ADD COLUMN "command" TEXT;
ALTER TABLE "HarnessTool" ADD COLUMN "permissionId" TEXT;
ALTER TABLE "HarnessTool" ADD COLUMN "timeoutMs" INTEGER;
ALTER TABLE "HarnessTool" ADD COLUMN "approvedInterventionId" TEXT;

-- The audit trail. One row per attempted invocation, including the ones that
-- never ran (recorded, or blocked pending approval).
CREATE TABLE "HarnessToolRun" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "harnessId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "command" TEXT,
    "cwd" TEXT,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "permissionId" TEXT,
    "interventionId" TEXT,
    "output" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarnessToolRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HarnessToolRun_toolId_createdAt_idx" ON "HarnessToolRun"("toolId", "createdAt" DESC);
CREATE INDEX "HarnessToolRun_harnessId_createdAt_idx" ON "HarnessToolRun"("harnessId", "createdAt" DESC);

ALTER TABLE "HarnessToolRun" ADD CONSTRAINT "HarnessToolRun_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "HarnessTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
