# Prior art: Type-directed merging (`merge-semantics`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- 8 sibling repair(s) across 4 model(s): hard-targeting/hard-debug-config-drift, hard-targeting/hard-fix-subtle-type-coercion

## Repair operations observed
- `numeric-coercion-removed` — seen in 4/8 repairs (hard-targeting/hard-debug-config-drift [deepseek/deepseek-v4-pro]; hard-targeting/hard-debug-config-drift [internal/default]; hard-targeting/hard-debug-config-drift [minimax/MiniMax-M3]; hard-targeting/hard-debug-config-drift [qwen/qwen3.8-max-preview])
- `strict-identity-compare` — seen in 4/8 repairs (hard-targeting/hard-fix-subtle-type-coercion [deepseek/deepseek-v4-pro]; hard-targeting/hard-fix-subtle-type-coercion [internal/default]; hard-targeting/hard-fix-subtle-type-coercion [minimax/MiniMax-M3]; hard-targeting/hard-fix-subtle-type-coercion [qwen/qwen3.8-max-preview])
- `loose-equality-removed` — seen in 4/8 repairs (hard-targeting/hard-fix-subtle-type-coercion [deepseek/deepseek-v4-pro]; hard-targeting/hard-fix-subtle-type-coercion [internal/default]; hard-targeting/hard-fix-subtle-type-coercion [minimax/MiniMax-M3]; hard-targeting/hard-fix-subtle-type-coercion [qwen/qwen3.8-max-preview])

## Files and symbols touched in sibling repairs
- src/client.js
- src/compare.js (symbols: is, inputs)

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Merge is type-directed: scalars replace, arrays combine, nested containers recurse. A generic shallow assign does none of this.
