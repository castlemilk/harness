# Prior art: Aggregating outcomes across parallel work (`error-aggregation`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- 4 sibling repair(s) across 4 model(s): hard-targeting/hard-fix-async-race

## Repair operations observed
- `queue-and-drain-loop` — seen in 2/4 repairs (hard-targeting/hard-fix-async-race [deepseek/deepseek-v4-pro]; hard-targeting/hard-fix-async-race [internal/default])
- `in-flight-guard-flag` — seen in 2/4 repairs (hard-targeting/hard-fix-async-race [deepseek/deepseek-v4-pro]; hard-targeting/hard-fix-async-race [internal/default])
- `caller-resolver-retained` — seen in 1/4 repairs (hard-targeting/hard-fix-async-race [deepseek/deepseek-v4-pro])

## Files and symbols touched in sibling repairs
- src/counter.js (symbols: processQueue, resolve, increment, drain, pending, next, chain, run, cur)

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Decide the aggregate outcome for every-input-failed, some-failed and none-failed before writing code, collect all outcomes without short-circuiting, and throw a collected error only when nothing succeeded.
