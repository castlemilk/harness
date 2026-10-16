# Prior art: Recency bookkeeping and eviction (`recency-ordering`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- 4 sibling repair(s) across 4 model(s): hard-targeting/hard-fix-on2-regression

## Repair operations observed
- `identity-keyed-memo` — seen in 4/4 repairs (hard-targeting/hard-fix-on2-regression [deepseek/deepseek-v4-pro]; hard-targeting/hard-fix-on2-regression [internal/default]; hard-targeting/hard-fix-on2-regression [minimax/MiniMax-M3]; hard-targeting/hard-fix-on2-regression [qwen/qwen3.8-max-preview])
- `arrays-combined` — seen in 3/4 repairs (hard-targeting/hard-fix-on2-regression [internal/default]; hard-targeting/hard-fix-on2-regression [minimax/MiniMax-M3]; hard-targeting/hard-fix-on2-regression [qwen/qwen3.8-max-preview])

## Files and symbols touched in sibling repairs
- src/search.js (symbols: seen, result, O, seenSet)

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Separate capacity enforcement from recency bookkeeping, refresh recency on every read and write, and evict the single least-recent entry after the refresh, not before.
