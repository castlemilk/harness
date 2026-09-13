CREATE TABLE "RuntimeConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'cuttlefish',
    "baseUrl" TEXT NOT NULL,
    "apiToken" TEXT,
    "externalProjectId" TEXT,
    "defaultWorkflowVersionId" TEXT,
    "workflowTemplate" TEXT,
    "nodeImage" TEXT,
    "nodeCommand" TEXT,
    "nodeTimeout" TEXT DEFAULT '30m',
    "nodeRetries" INTEGER,
    "runnerPool" TEXT,
    "runnerLabels" TEXT,
    "runnerCapabilities" TEXT,
    "dispatchMode" TEXT DEFAULT 'autopilot',
    "intentProfile" TEXT,
    "candidateLimit" INTEGER,
    "baseInputs" TEXT,
    "autoRoute" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthStatus" TEXT,
    "lastHealthAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RuntimeConnection_name_key" ON "RuntimeConnection"("name");
CREATE INDEX "RuntimeConnection_projectId_idx" ON "RuntimeConnection"("projectId");

CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "runtimeId" TEXT,
    "externalRunId" TEXT NOT NULL,
    "workflowName" TEXT,
    "workflowVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "inputs" TEXT,
    "outputs" TEXT,
    "artifacts" TEXT,
    "error" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowRun_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "RuntimeConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "FlowRun_taskId_idx" ON "FlowRun"("taskId");
CREATE INDEX "FlowRun_runtimeId_idx" ON "FlowRun"("runtimeId");
CREATE INDEX "FlowRun_externalRunId_idx" ON "FlowRun"("externalRunId");
CREATE INDEX "FlowRun_status_idx" ON "FlowRun"("status");
