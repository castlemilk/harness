CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'single',
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "passedTasks" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "results" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BenchmarkRun_status_idx" ON "BenchmarkRun"("status");
