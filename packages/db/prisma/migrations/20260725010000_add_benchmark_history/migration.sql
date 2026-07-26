CREATE TABLE "BenchmarkHistory" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "passRate" DOUBLE PRECISION NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "passedTasks" INTEGER NOT NULL,
    "totalCostUsd" DOUBLE PRECISION NOT NULL,
    "avgCostPerTask" DOUBLE PRECISION NOT NULL,
    "avgDurationMs" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenchmarkHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BenchmarkHistory_suite_idx" ON "BenchmarkHistory"("suite");
CREATE INDEX "BenchmarkHistory_provider_model_idx" ON "BenchmarkHistory"("provider", "model");
