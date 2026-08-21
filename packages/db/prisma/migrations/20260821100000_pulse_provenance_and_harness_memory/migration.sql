-- Pulse provenance: which model actually served the call (substitution-aware),
-- and the exact prompt/response exchanged — the audit trail for a session.
-- All nullable and additive; rows predating the columns stay honest nulls.
ALTER TABLE "Pulse" ADD COLUMN "model" TEXT;
ALTER TABLE "Pulse" ADD COLUMN "promptText" TEXT;
ALTER TABLE "Pulse" ADD COLUMN "responseText" TEXT;

-- Rolling working memory a harness carries across its otherwise-stateless
-- heartbeat pulses. Replaced wholesale each pulse the model returns one.
ALTER TABLE "Harness" ADD COLUMN "memory" TEXT;
