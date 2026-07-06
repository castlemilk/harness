---
name: kea-atomic-selectors
description: TypeScript Kea framework - adding atomic signal selectors, logic.selectorHealth, and React integration
args: []
---

# Kea Atomic Selector Integration Guide

When a task asks you to add atomic/signal selectors to Kea, treat it as a framework wiring task. The feature must be integrated into Kea's existing selector engine, reducer update path, and React subscription system. Do not leave it in standalone files and do not create your own test files.

## What NOT to do

- Do NOT create or modify test files (e.g. `test/jest/atomic.js`). The benchmark/verifier supplies its own tests. Modifying tests gives false positives.
- Do NOT implement a parallel selector engine in a standalone file and bypass Kea's existing `selectors` plugin. You must hook into the existing selector creation and value-read paths.
- Do NOT modify `rollup.config.js`, `tsconfig.json`, or build tooling unless the task explicitly requires it.

## Files you MUST modify

1. `src/kea/context.ts`
   - Read `resetContext` options and add `atomicSelectors: boolean` (default `false`).
   - Store it on `context.options` so every plugin can read it.

2. `src/core/selectors.ts`
   - This is where Kea builds selectors with `createSelector` from reselect.
   - When `getContext().options.atomicSelectors` is true, wrap each selector with atomic dependency tracking instead of (or in addition to) plain reselect.
   - Record per-selector metadata: `dependencies` (leaf paths like `user.name`), `dependents`, `evaluations`, `dirtyCause`.
   - Keep the selector function signature `(state, props) => result` unchanged.

3. `src/kea/build.ts`
   - In `getBuiltLogic`, after the built `logic` object is created, attach `logic.selectorHealth` as a method.
   - `selectorHealth()` must return `{ selectors: Record<name, { dependencies, dependents, evaluations, dirtyCause }>, topologicalOrder: string[] }`.
   - The metadata must be keyed by the selector's local name (e.g. `userName`) and stable across remounts.

4. `src/kea/kea.ts`
   - The `kea({...})` wrapper must also expose `selectorHealth` when atomic mode is enabled, because tests call `logic.mount(); logic.selectorHealth()` directly on the wrapper.
   - Add `wrapper.selectorHealth = () => wrapper.build().selectorHealth()` (or proxy it via `proxyFieldToLogic` if `selectorHealth` is registered as a logic field).
   - Do this only when `getContext().options.atomicSelectors` is true.

5. `src/core/reducers.ts` or wherever actions are dispatched
   - Hook into reducer updates so that when an action changes state, the atomic engine knows which leaf paths changed.
   - Mark dependent selectors dirty and set `dirtyCause` to the changed leaf path.
   - Multiple changes in one action must coalesce into a single selector re-evaluation.

6. `src/react/hooks.ts` (or the React binding file)
   - Kea re-renders components via selectors. The atomic engine must integrate with the subscription path so that a component re-renders only when a leaf path it actually reads changes.
   - Do not break existing Kea React behavior when `atomicSelectors` is false.

7. `src/index.ts`
   - Export any public helpers/types needed by consumers (e.g. `AtomicSelectorHealth`, `AtomicSelectorEngine`).

## Implementation notes

- `logic.selectorHealth()` must exist on **both** the `BuiltLogic` instance (created in `src/kea/build.ts`) and the `LogicWrapper` returned by `kea({...})` (created in `src/kea/kea.ts`).
- Dependencies must be leaf-level paths like `user.name`, not just `user`.
- For collections use the exact dependency strings the task specifies:
  - Map key access: `<reducer>.map:<key>` (e.g. `data.map:a`)
  - Set membership: `<reducer>.set:<value>` (e.g. `data.set:a`)
  - Array indices: `<reducer>.<index>` (e.g. `list.0`)
- Circular dependency detection must happen during logic mounting/building and throw an error containing `[KEA] Circular dependency detected`.
- Atomic mode must default to `false` and only activate after `resetContext({ atomicSelectors: true })`.

## Verification

- After every source edit, run the focused test file: `npx jest test/jest/atomic.js` (or the relevant jest file). If it does not exist yet, run the full suite: `npm test` or `pnpm test`.
- Before finishing, run a concrete API surface check with `verify_api_surface`. The check must mount a logic and test:
  - `typeof logic.selectorHealth === 'function'` on the wrapper returned by `kea({...})`
  - `typeof built.selectorHealth === 'function'` on the object returned by `logic.build()`
- Do not finish until both checks pass.
