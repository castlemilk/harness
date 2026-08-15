-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targetDate" TIMESTAMP(3),
    "spendCapUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectivePhase" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "detail" TEXT,
    "orderIdx" INTEGER NOT NULL,

    CONSTRAINT "ObjectivePhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workstream" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "pausedNote" TEXT,
    "orderIdx" INTEGER NOT NULL DEFAULT 0,
    "leadHarnessId" TEXT,

    CONSTRAINT "Workstream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Harness" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "activity" TEXT,
    "mission" TEXT NOT NULL,
    "currentJob" TEXT,
    "model" TEXT NOT NULL,
    "playbookId" TEXT,
    "taskId" TEXT,
    "branch" TEXT,
    "heartbeatMinutes" INTEGER NOT NULL DEFAULT 30,
    "nextPulseAt" TIMESTAMP(3),
    "maxChildren" INTEGER NOT NULL DEFAULT 3,
    "spendCapUsd" DOUBLE PRECISION,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contextTokens" INTEGER NOT NULL DEFAULT 0,
    "contextWindow" INTEGER NOT NULL DEFAULT 200000,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "lastPulseSeq" INTEGER NOT NULL DEFAULT 0,
    "idleSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Harness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pulse" (
    "id" TEXT NOT NULL,
    "harnessId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "summary" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,

    CONSTRAINT "Pulse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "harnessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "impact" TEXT,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "variables" TEXT NOT NULL DEFAULT '[]',
    "cadence" TEXT NOT NULL DEFAULT 'every 30m',
    "retireWhen" TEXT,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessTool" (
    "id" TEXT NOT NULL,
    "harnessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" TEXT,
    "lastResultLabel" TEXT,
    "lastRanAt" TIMESTAMP(3),

    CONSTRAINT "HarnessTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Objective_projectId_idx" ON "Objective"("projectId");

-- CreateIndex
CREATE INDEX "ObjectivePhase_objectiveId_idx" ON "ObjectivePhase"("objectiveId");

-- CreateIndex
CREATE INDEX "Workstream_objectiveId_idx" ON "Workstream"("objectiveId");

-- CreateIndex
CREATE INDEX "Harness_objectiveId_status_idx" ON "Harness"("objectiveId", "status");

-- CreateIndex
CREATE INDEX "Harness_parentId_idx" ON "Harness"("parentId");

-- CreateIndex
CREATE INDEX "Harness_workstreamId_idx" ON "Harness"("workstreamId");

-- CreateIndex
CREATE UNIQUE INDEX "Pulse_harnessId_seq_key" ON "Pulse"("harnessId", "seq");

-- CreateIndex
CREATE INDEX "Pulse_harnessId_seq_idx" ON "Pulse"("harnessId", "seq" DESC);

-- CreateIndex
CREATE INDEX "Intervention_objectiveId_status_idx" ON "Intervention"("objectiveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Playbook_name_version_key" ON "Playbook"("name", "version");

-- CreateIndex
CREATE INDEX "HarnessTool_harnessId_idx" ON "HarnessTool"("harnessId");

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectivePhase" ADD CONSTRAINT "ObjectivePhase_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Harness" ADD CONSTRAINT "Harness_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Harness" ADD CONSTRAINT "Harness_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Harness" ADD CONSTRAINT "Harness_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Harness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pulse" ADD CONSTRAINT "Pulse_harnessId_fkey" FOREIGN KEY ("harnessId") REFERENCES "Harness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessTool" ADD CONSTRAINT "HarnessTool_harnessId_fkey" FOREIGN KEY ("harnessId") REFERENCES "Harness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
