-- Schema drift repair: schema.prisma declares provider/model/totalCostUsd/
-- totalTokens nullable on BenchmarkHistory, but the creating migration made
-- them NOT NULL. saveBenchmarkHistory writes `sum || null` when a run reports
-- no cost/tokens, so any cost-less run (every external CLI except
-- claude-code) crashed the history write. Align the DB with the schema.
ALTER TABLE "BenchmarkHistory" ALTER COLUMN "provider" DROP NOT NULL;
ALTER TABLE "BenchmarkHistory" ALTER COLUMN "model" DROP NOT NULL;
ALTER TABLE "BenchmarkHistory" ALTER COLUMN "totalCostUsd" DROP NOT NULL;
ALTER TABLE "BenchmarkHistory" ALTER COLUMN "totalTokens" DROP NOT NULL;
