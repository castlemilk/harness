-- Comprehensive schema drift fix (2026-07-28, v2 - idempotent)
-- Aligns actual PGlite tables with the current Prisma schema.

-- ============================================================
-- BenchmarkRun
-- ============================================================

-- Add columns (IF NOT EXISTS makes this safe to re-run)
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "passed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "timeouts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "totalDurationMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "totalCostUsd" DOUBLE PRECISION;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "totalTokens" INTEGER;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "BenchmarkRun" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop stale columns (only if they still exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkRun' AND column_name = 'passedTasks') THEN
    UPDATE "BenchmarkRun" SET "passed" = "passedTasks";
    ALTER TABLE "BenchmarkRun" DROP COLUMN "passedTasks";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkRun' AND column_name = 'completedTasks') THEN
    ALTER TABLE "BenchmarkRun" DROP COLUMN "completedTasks";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkRun' AND column_name = 'strategy') THEN
    ALTER TABLE "BenchmarkRun" DROP COLUMN "strategy";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BenchmarkRun_suite_idx" ON "BenchmarkRun"("suite");
CREATE INDEX IF NOT EXISTS "BenchmarkRun_createdAt_idx" ON "BenchmarkRun"("createdAt");

-- ============================================================
-- BenchmarkHistory
-- ============================================================

ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "timeouts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "totalDurationMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "totalTokens" INTEGER;
ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "reportPath" TEXT;
ALTER TABLE "BenchmarkHistory" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop stale columns if they still exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkHistory' AND column_name = 'passedTasks') THEN
    UPDATE "BenchmarkHistory" SET "passed" = "passedTasks";
    ALTER TABLE "BenchmarkHistory" DROP COLUMN "passedTasks";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkHistory' AND column_name = 'avgCostPerTask') THEN
    ALTER TABLE "BenchmarkHistory" DROP COLUMN "avgCostPerTask";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkHistory' AND column_name = 'avgDurationMs') THEN
    ALTER TABLE "BenchmarkHistory" DROP COLUMN "avgDurationMs";
  END IF;
  -- Make provider/model nullable if currently NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkHistory' AND column_name = 'provider' AND is_nullable = 'NO') THEN
    ALTER TABLE "BenchmarkHistory" ALTER COLUMN "provider" DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BenchmarkHistory' AND column_name = 'model' AND is_nullable = 'NO') THEN
    ALTER TABLE "BenchmarkHistory" ALTER COLUMN "model" DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BenchmarkHistory_createdAt_idx" ON "BenchmarkHistory"("createdAt");
