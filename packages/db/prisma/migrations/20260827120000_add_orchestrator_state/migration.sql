-- Persist the orchestration plan and execution frontier so interrupted runs can resume.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "orchestratorState" TEXT;
