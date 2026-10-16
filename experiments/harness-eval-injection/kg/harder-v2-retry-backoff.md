# Prior art: Computing a delay schedule (`retry-schedule`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- No sibling repairs for this bug class exist in the corpus.

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Express the delay as a formula over base and attempt index computed per call, so concurrent retries cannot share mutable schedule state.
