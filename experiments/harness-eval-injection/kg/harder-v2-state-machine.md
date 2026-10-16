# Prior art: Validating state transitions (`transition-validation`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- 4 sibling repair(s) across 4 model(s): hard-targeting/hard-spec-ambiguous-correctness

## Repair operations observed
- `strict-identity-compare` — seen in 3/4 repairs (hard-targeting/hard-spec-ambiguous-correctness [internal/default]; hard-targeting/hard-spec-ambiguous-correctness [minimax/MiniMax-M3]; hard-targeting/hard-spec-ambiguous-correctness [qwen/qwen3.8-max-preview])

## Files and symbols touched in sibling repairs
- src/slug.js (symbols: result)

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Permitted transitions belong in one lookup table, consulted by a single decision point, and a rejected transition must leave observable state unchanged.
