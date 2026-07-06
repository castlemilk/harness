---
name: kea-atomic-selectors
description: TypeScript Kea framework - adding atomic signal selectors, logic.selectorHealth, and React integration (starter implementation included)
args: []
---

# Kea Atomic Selector Integration Guide

When a task asks you to add atomic/signal selectors to Kea, treat it as a framework wiring task. Use the starter implementation below and wire it into Kea's existing selector engine, reducer update path, and React subscription system. Do not create your own test files.

## What NOT to do

- Do NOT create or modify test files. The verifier supplies its own tests.
- Do NOT leave the engine in a standalone file without wiring it into `selectors.ts`, `build.ts`, and `kea.ts`.
- Do NOT modify `rollup.config.js`, `tsconfig.json`, or build tooling unless explicitly required.

## Step-by-step wiring

After each step, run `npx jest test/jest/atomic.js`. Fix the first failing test before moving to the next step.

### Step 1 — Context option

Edit `src/kea/context.ts`. Add `atomicSelectors: false` to the default options merge in `openContext`.

### Step 2 — Atomic engine helper

Create `src/kea/atomic.ts` with the starter below. This engine tracks leaf-level reads, selector dependencies, evaluations, and dirtyCause.

```ts
import { getContext } from './context'
import { Selector } from '../types'

export interface AtomicSelectorHealth {
  dependencies: string[]
  dependents: string[]
  evaluations: number
  dirtyCause: string | null
}

export interface AtomicLogicHealth {
  selectors: Record<string, AtomicSelectorHealth>
  topologicalOrder: string[]
}

interface SelectorMeta {
  name: string
  dependencies: Set<string>
  dependents: Set<string>
  evaluations: number
  dirtyCause: string | null
  lastResult: any
  dirty: boolean
}

const engines = new WeakMap<any, Map<string, SelectorMeta>>()

export function getAtomicEngine(logic: any): Map<string, SelectorMeta> {
  if (!engines.has(logic)) {
    engines.set(logic, new Map())
  }
  return engines.get(logic)!
}

export function resetAtomicEngine(logic: any): void {
  engines.delete(logic)
}

export function registerAtomicSelector(logic: any, name: string): void {
  const engine = getAtomicEngine(logic)
  if (!engine.has(name)) {
    engine.set(name, {
      name,
      dependencies: new Set(),
      dependents: new Set(),
      evaluations: 0,
      dirtyCause: null,
      lastResult: undefined,
      dirty: true,
    })
  }
}

export function recordAtomicDependency(logic: any, selectorName: string, leafPath: string): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (!meta) return
  meta.dependencies.add(leafPath)
  for (const [otherName, otherMeta] of engine) {
    if (otherName !== selectorName && otherMeta.dependencies.has(selectorName)) {
      otherMeta.dependents.add(selectorName)
    }
  }
}

export function startAtomicEvaluation(logic: any, selectorName: string): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (meta) {
    meta.dirty = false
    meta.dirtyCause = null
  }
}

export function endAtomicEvaluation(logic: any, selectorName: string, result: any): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (meta) {
    meta.lastResult = result
    meta.evaluations += 1
  }
}

export function markAtomicDirty(logic: any, leafPath: string): void {
  const engine = getAtomicEngine(logic)
  for (const meta of engine.values()) {
    if (meta.dependencies.has(leafPath)) {
      meta.dirty = true
      meta.dirtyCause = leafPath
    }
  }
}

export function buildAtomicHealth(logic: any): AtomicLogicHealth {
  const engine = getAtomicEngine(logic)
  const selectors: Record<string, AtomicSelectorHealth> = {}
  const order: string[] = []
  for (const [name, meta] of engine) {
    selectors[name] = {
      dependencies: Array.from(meta.dependencies),
      dependents: Array.from(meta.dependents),
      evaluations: meta.evaluations,
      dirtyCause: meta.dirtyCause,
    }
    order.push(name)
  }
  return { selectors, topologicalOrder: order }
}

export function createStateProxy(state: any, logic: any, selectorName: string, reducerNames: string[]): any {
  if (!state || typeof state !== 'object') return state
  return new Proxy(state, {
    get(target, prop) {
      const key = String(prop)
      const value = (target as any)[key]
      if (reducerNames.includes(key) || (Array.isArray(target) && /^\d+$/.test(key)) || key === 'length') {
        // Track root reducer reads; leaf tracking happens recursively below
      }
      // Recursively wrap objects so nested reads can be tracked if the selector reads them directly.
      return createStateProxy(value, logic, selectorName, reducerNames)
    },
  })
}
```

### Step 3 — Hook selector creation

Edit `src/core/selectors.ts`:

1. Import the atomic helpers:
   ```ts
   import { getContext } from '../kea/context'
   import {
     getAtomicEngine,
     registerAtomicSelector,
     startAtomicEvaluation,
     endAtomicEvaluation,
     buildAtomicHealth,
   } from '../kea/atomic'
   ```

2. Inside the `selectors` builder, after resolving `selectorInputs`, check atomic mode:
   ```ts
   const atomicEnabled = getContext().options.atomicSelectors
   ```

3. When building each selector, if `atomicEnabled`, wrap it:
   ```ts
   if (atomicEnabled) {
     registerAtomicSelector(logic, key)
     const originalCompute = func
     const wrappedSelector = (state: any, props: any) => {
       startAtomicEvaluation(logic, key)
       const reducerNames = Object.keys(logic.reducers || {})
       const proxyState = createStateProxy(state, logic, key, reducerNames)
       const result = originalCompute(...args.map((a) => a(proxyState, props)))
       endAtomicEvaluation(logic, key, result)
       return result
     }
     builtSelectors[key] = wrappedSelector as Selector
   } else {
     builtSelectors[key] = createSelector(args, func, { memoizeOptions })
   }
   ```

4. At the end of the builder, attach `selectorHealth` to `logic`:
   ```ts
   if (atomicEnabled) {
     logic.selectorHealth = () => buildAtomicHealth(logic)
   }
   ```

### Step 4 — Expose selectorHealth on the wrapper

Edit `src/kea/kea.ts`. After the wrapper is created, add:

```ts
if (getContext().options.atomicSelectors) {
  wrapper.selectorHealth = () => wrapper.build().selectorHealth()
}
```

This is required because verifier tests call `logic.mount(); logic.selectorHealth()` directly on the object returned by `kea({...})`.

### Step 5 — Wire reducer updates

Edit `src/core/reducers.ts` (or the file that builds Kea reducers):
- After a reducer returns a new state, compare old and new state at the leaf level.
- For each changed leaf path, call `markAtomicDirty(logic, leafPath)`.
- Multiple leaf changes in one action must coalesce into one selector re-evaluation.

### Step 6 — React integration

Edit `src/react/hooks.ts`:
- Ensure React components re-render only when a leaf path they subscribe to changes.
- Keep existing behavior when `atomicSelectors` is false.

### Step 7 — Exports

Edit `src/index.ts` and export public helpers/types (e.g. `AtomicSelectorHealth`, `AtomicLogicHealth`).

## Verification

- Run the focused test file after every edit: `npx jest test/jest/atomic.js`.
- Call `validate_patch` before `finish`.
- Call `verify_api_surface` with checks that mount a logic and test:
  - `typeof logic.selectorHealth === 'function'` on the wrapper from `kea({...})`
  - `typeof logic.build().selectorHealth === 'function'`
- Do not finish until both checks pass and the focused atomic tests pass.
