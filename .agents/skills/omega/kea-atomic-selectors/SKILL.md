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

## Step-by-step implementation order

Follow this order exactly. After each file edit, run `npx jest test/jest/atomic.js` (or `npm test` if it does not exist) and fix the first failure before editing the next file.

### Step 1 — Add the context option

Edit `src/kea/context.ts`:
- In the `openContext` function, add `atomicSelectors: false` to the default options merge.
- The option is read via `getContext().options.atomicSelectors`.

### Step 2 — Hook selector creation

Edit `src/core/selectors.ts`:
- After the selector inputs are resolved, check `const atomicEnabled = getContext().options.atomicSelectors`.
- When `atomicEnabled` is true, wrap each built selector with a function that:
  - Tracks leaf-level state reads (e.g. `user.name`, not just `user`).
  - Records dependencies, dependents, evaluations, and dirtyCause per selector.
  - Returns the same result as the original selector so existing Kea behavior is preserved.
- You may create a small helper module (e.g. `src/kea/atomic.ts`) for the tracking engine, but the selector wrapping must happen inside `src/core/selectors.ts`.

### Step 3 — Expose selectorHealth on BuiltLogic

Edit `src/kea/build.ts`:
- In `getBuiltLogic`, after the `logic` object is created, attach:
  ```ts
  if (getContext().options.atomicSelectors) {
    logic.selectorHealth = () => buildAtomicHealth(logic)
  }
  ```
- `selectorHealth()` must return `{ selectors: Record<name, { dependencies, dependents, evaluations, dirtyCause }>, topologicalOrder: string[] }`.
- Metadata keys must be the selector's local name (e.g. `userName`).

### Step 4 — Expose selectorHealth on the wrapper

Edit `src/kea/kea.ts`:
- After the wrapper is created, attach:
  ```ts
  if (getContext().options.atomicSelectors) {
    wrapper.selectorHealth = () => wrapper.build().selectorHealth()
  }
  ```
- This is required because tests call `logic.mount(); logic.selectorHealth()` directly on the object returned by `kea({...})`.

### Step 5 — Wire reducer updates

Edit `src/core/reducers.ts` (or the file that builds Kea reducers):
- When an action is dispatched, compare the new state to the previous state at the leaf level.
- Mark affected selectors dirty and set `dirtyCause` to the changed leaf path.
- Multiple leaf changes in one action must coalesce into one selector re-evaluation.

### Step 6 — Preserve React integration

Edit `src/react/hooks.ts` (or the React binding file):
- Ensure React components re-render only when a leaf path they subscribe to changes.
- Do not break existing Kea React behavior when `atomicSelectors` is false.

### Step 7 — Export public types

Edit `src/index.ts`:
- Export public helpers/types needed by consumers (e.g. `AtomicSelectorHealth`).

## Implementation notes

- `logic.selectorHealth()` must exist on **both** the `BuiltLogic` instance and the `LogicWrapper` returned by `kea({...})`.
- Dependencies must be leaf-level paths like `user.name`, not just `user`.
- For collections use the exact dependency strings the task specifies:
  - Map key access: `<reducer>.map:<key>` (e.g. `data.map:a`)
  - Set membership: `<reducer>.set:<value>` (e.g. `data.set:a`)
  - Array indices: `<reducer>.<index>` (e.g. `list.0`)
- Circular dependency detection must happen during logic mounting/building and throw an error containing `[KEA] Circular dependency detected`.
- Atomic mode must default to `false` and only activate after `resetContext({ atomicSelectors: true })`.

## Verification

- Run the focused test file after every edit: `npx jest test/jest/atomic.js`.
- Before finishing, run a concrete API surface check with `verify_api_surface`. The check must mount a logic and test:
  - `typeof logic.selectorHealth === 'function'` on the wrapper returned by `kea({...})`
  - `typeof built.selectorHealth === 'function'` on the object returned by `logic.build()`
- Do not finish until both checks pass and the focused atomic tests pass.
