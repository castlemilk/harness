-- CreateTable
CREATE TABLE "TraceSpan" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "parentId" TEXT,
    "taskId" TEXT,
    "name" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ok',
    "attributes" TEXT,
    "events" TEXT,

    CONSTRAINT "TraceSpan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TraceSpan_traceId_idx" ON "TraceSpan"("traceId");

-- CreateIndex
CREATE INDEX "TraceSpan_taskId_idx" ON "TraceSpan"("taskId");

-- AddForeignKey
ALTER TABLE "TraceSpan" ADD CONSTRAINT "TraceSpan_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
