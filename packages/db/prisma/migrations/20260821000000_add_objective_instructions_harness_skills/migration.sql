-- Objective-level standing instructions: free text injected into the system
-- prompt of every pulse of every harness under the objective. Nullable and
-- additive — an objective without instructions prompts exactly as before.
ALTER TABLE "Objective" ADD COLUMN "instructions" TEXT;

-- Per-harness skill grants: a JSON array of SkillArtifact names whose SKILL.md
-- bodies are injected into the pulse system prompt. Defaults to none.
ALTER TABLE "Harness" ADD COLUMN "skills" TEXT NOT NULL DEFAULT '[]';
