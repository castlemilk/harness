# Prior art: Traversing self-referential structures (`graph-traversal-memo`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- No sibling repairs for this bug class exist in the corpus.

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Identity-keyed memoisation must register a container before descending into it so that a reference back to an ancestor resolves inside the copy instead of recursing again.
