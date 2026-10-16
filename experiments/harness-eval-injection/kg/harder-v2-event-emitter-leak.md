# Prior art: Listener identity and cleanup (`listener-identity`)

Drawn from repairs of this bug class elsewhere in the evaluation corpus.
This task's own patches and failures are excluded. Sibling evidence is reduced to
operations, files and symbols — no diff content.

## Coverage
- 5 sibling repair(s) across 5 model(s): hard-targeting/hard-debug-event-listener-leak

## Repair operations observed
- `callback-reference-captured` — seen in 5/5 repairs (hard-targeting/hard-debug-event-listener-leak [deepseek/deepseek-v4-pro]; hard-targeting/hard-debug-event-listener-leak [external/agy]; hard-targeting/hard-debug-event-listener-leak [internal/default]; hard-targeting/hard-debug-event-listener-leak [minimax/MiniMax-M3]; hard-targeting/hard-debug-event-listener-leak [qwen/qwen3.8-max-preview])
- `listener-removed-by-identity` — seen in 5/5 repairs (hard-targeting/hard-debug-event-listener-leak [deepseek/deepseek-v4-pro]; hard-targeting/hard-debug-event-listener-leak [external/agy]; hard-targeting/hard-debug-event-listener-leak [internal/default]; hard-targeting/hard-debug-event-listener-leak [minimax/MiniMax-M3]; hard-targeting/hard-debug-event-listener-leak [qwen/qwen3.8-max-preview])

## Files and symbols touched in sibling repairs
- src/server.js (symbols: listener, tickListener, onTick)

## Recorded failure modes for this class
- None recorded in the corpus.

## Distilled shape
Cleanup only works by identity. The registration and the removal must name the exact same function object; a fresh closure is a different object and removes nothing.
