-- Which use-case shell an objective renders in. Nullable and additive: an
-- objective with no use case keeps the core Foreman chrome exactly as before.
ALTER TABLE "Objective" ADD COLUMN "useCase" TEXT;
