---
name: kea-atomic-selectors
description: TypeScript Kea framework - adding atomic signal selectors and logic.selectorHealth
args: []
---

# Kea Atomic Selector Integration Guide

When a task asks you to add atomic/signal selectors to Kea, the implementation is not complete until you modify the existing Kea source files to wire the feature in. Do not leave the code in standalone files.

## Files you MUST modify

1. `src/kea/build.ts`
   - The `BuiltLogic` object is constructed in `getBuiltLogic()` around lines 88-119.
   - After the basic methods (`mount`, `unmount`, `isMounted`) are attached, attach `selectorHealth`.
   - `selectorHealth` must be a method on the logic instance that returns health metadata for every selector in this logic.

2. `src/core/selectors.ts`
   - This is where Kea selectors are registered and built.
   - If implementing atomic tracking, hook into selector creation so that dependencies, evaluations, and dependents are recorded.
   - Import and use your atomic engine here or in `src/kea/build.ts`.

3. `src/kea/context.ts`
   - Read the `atomicSelectors` option from `resetContext({ atomicSelectors: true })`.
   - Store it on the context/options so that `src/kea/build.ts` and `src/core/selectors.ts` can decide whether to enable atomic tracking.

4. `src/index.ts`
   - Export any public helpers/types needed by consumers (e.g., `AtomicSelectorHealth`, `AtomicSelectorEngine`).

## Wiring checklist

- [ ] `logic.selectorHealth()` exists on mounted BuiltLogic instances.
- [ ] `logic.selectorHealth()` returns `{ selectors: Record<name, { dependencies, dependents, evaluations, dirtyCause }>, topologicalOrder: string[] }`.
- [ ] Dependencies are leaf-level paths like `user.name`, not just `user`.
- [ ] The engine is only active when `resetContext({ atomicSelectors: true })` was used.
- [ ] Existing Kea tests still pass.
- [ ] New atomic selector tests pass.

## Verification

Before finishing, run the test command and also run a quick runtime check:

```js
const { kea } = require('./src/index.ts') // or built output
const logic = kea({ selectors: { userName: [(s) => s.user, (u) => u.name]] } })
logic.mount()
console.log(typeof logic.selectorHealth) // must be 'function'
```

If `logic.selectorHealth` is `undefined`, you have not wired it into `src/kea/build.ts`. Fix that before finishing.
