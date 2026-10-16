# Prior art: Bounding concurrent execution (`concurrency-gate`)

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
Model the limit as a running-count plus a pending queue, and release capacity on both success and failure paths so a rejected unit cannot permanently consume a slot.
