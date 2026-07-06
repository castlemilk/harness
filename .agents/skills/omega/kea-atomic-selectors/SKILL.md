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
- Do NOT break React/Redux referential equality. The tracking proxy must record reads but return the original underlying values to consumers.

## Step-by-step wiring

After each step, run `npx jest test/jest/atomic.js`. Fix the first failing test before moving to the next step.

### Step 1 — Context option

Edit `src/kea/context.ts`. Add `atomicSelectors: false` to the default options merge in `openContext`.

### Step 2 — Atomic engine helper

Create `src/kea/atomic.ts` with the starter below.

```ts
import { getContext } from './context'

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
const evaluationStack = new Set<string>()

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

export function recordAtomicDependency(logic: any, selectorName: string, path: string): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (!meta) return
  meta.dependencies.add(path)
}

export function recordAtomicSelectorDependency(logic: any, selectorName: string, inputSelectorName: string): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  const inputMeta = engine.get(inputSelectorName)
  if (meta && inputMeta) {
    meta.dependencies.add(inputSelectorName)
    inputMeta.dependents.add(selectorName)
  }
}

export function startAtomicEvaluation(logic: any, selectorName: string): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (meta) {
    meta.dirty = false
    meta.dirtyCause = null
  }
  const stackKey = `${logic.pathString || 'unknown'}::${selectorName}`
  if (evaluationStack.has(stackKey)) {
    throw new Error('[KEA] Circular dependency detected')
  }
  evaluationStack.add(stackKey)
}

export function endAtomicEvaluation(logic: any, selectorName: string, result: any): void {
  const engine = getAtomicEngine(logic)
  const meta = engine.get(selectorName)
  if (meta) {
    meta.lastResult = result
    meta.evaluations += 1
  }
  const stackKey = `${logic.pathString || 'unknown'}::${selectorName}`
  evaluationStack.delete(stackKey)
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

function buildLeafPath(reducerNames: string[], path: string[]): string {
  // The first segment that is a reducer name starts the path.
  let start = 0
  for (let i = 0; i < path.length; i++) {
    if (reducerNames.includes(path[i])) {
      start = i
      break
    }
  }
  return path.slice(start).join('.')
}

export function createStateProxy(
  state: any,
  logic: any,
  selectorName: string,
  reducerNames: string[],
  path: string[] = [],
): any {
  if (state === null || typeof state !== 'object') {
    return state
  }

  const record = (key: string, value: any) => {
    const leafPath = buildLeafPath(reducerNames, path.concat(key))
    recordAtomicDependency(logic, selectorName, leafPath)
  }

  if (state instanceof Map) {
    return new Proxy(state, {
      get(target, prop) {
        const key = String(prop)
        if (key === 'get') {
          return function (mapKey: any) {
            record(`map:${mapKey}`, target.get(mapKey))
            return target.get(mapKey)
          }
        }
        if (key === 'has') {
          return function (mapKey: any) {
            record(`map:${mapKey}`, target.has(mapKey))
            return target.has(mapKey)
          }
        }
        const value = (target as any)[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  if (state instanceof Set) {
    return new Proxy(state, {
      get(target, prop) {
        const key = String(prop)
        if (key === 'has' || key === 'includes') {
          return function (setValue: any) {
            record(`set:${setValue}`, target.has(setValue))
            return target.has(setValue)
          }
        }
        const value = (target as any)[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  if (Array.isArray(state)) {
    return new Proxy(state, {
      get(target, prop) {
        const key = String(prop)
        if (/^\d+$/.test(key) || key === 'length') {
          record(key, (target as any)[key])
        }
        if (key === 'includes' || key === 'indexOf' || key === 'find' || key === 'some') {
          const fn = (target as any)[key]
          return function (...fnArgs: any[]) {
            // For includes/indexOf the first arg is the searched value.
            if ((key === 'includes' || key === 'indexOf') && fnArgs.length > 0) {
              record(fnArgs[0], true)
            }
            return fn.apply(target, fnArgs)
          }
        }
        const value = (target as any)[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  return new Proxy(state, {
    get(target, prop) {
      const key = String(prop)
      const value = (target as any)[key]
      record(key, value)
      return value
    },
  })
}
```

### Step 3 — Hook selector creation

Edit `src/core/selectors.ts`:

1. Import the atomic helpers.
2. Inside the `selectors` builder, after resolving `selectorInputs`, check `const atomicEnabled = getContext().options.atomicSelectors`.
3. When building each selector, if `atomicEnabled`, wrap it:
   ```ts
   if (atomicEnabled) {
     registerAtomicSelector(logic, key)
     const originalCompute = func
     const builtSelector = (state: any, props: any) => {
       startAtomicEvaluation(logic, key)
       const reducerNames = Object.keys(logic.reducers || {})
       const proxyState = createStateProxy(state, logic, key, reducerNames)
       const inputResults = args.map((a) => {
         const inputName = (a as any).__keaSelectorName || (a as any).selectorName
         if (inputName) {
           recordAtomicSelectorDependency(logic, key, inputName)
         }
         return a(proxyState, props)
       })
       const result = originalCompute(...inputResults)
       endAtomicEvaluation(logic, key, result)
       return result
     }
     builtSelectors[key] = builtSelector as Selector
   } else {
     builtSelectors[key] = createSelector(args, func, { memoizeOptions })
   }
   ```
4. Tag each built selector with its name so chained selectors can detect dependencies:
   ```ts
   ;(builtSelectors[key] as any).__keaSelectorName = key
   ```
5. At the end of the builder, attach `selectorHealth` to `logic`:
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

### Step 5 — Wire reducer updates

Edit `src/core/reducers.ts`:
- After a reducer returns a new state, compare old and new state at the leaf level.
- For each changed leaf path, call `markAtomicDirty(logic, leafPath)`.
- Multiple leaf changes in one action must coalesce into one selector re-evaluation.

### Step 6 — React integration

Edit `src/react/hooks.ts`:
- Ensure React components re-render only when a leaf path they subscribe to changes.
- Keep existing behavior when `atomicSelectors` is false.
- Do not introduce infinite loops; selectors must remain referentially stable.

### Step 7 — Exports

Edit `src/index.ts` and export public helpers/types.

## Verification

- Run the focused test file after every edit: `npx jest test/jest/atomic.js`.
- Call `validate_patch` before `finish`.
- CRITICAL: Before finish, call `verify_api_surface` with EXACTLY this check (copy it verbatim):
  ```js
  const { kea, resetContext } = require('./src/index.ts')
  resetContext({ atomicSelectors: true })
  const logic = kea({
    actions: { setName: (n) => ({ n }) },
    reducers: { user: [(s) => s || { name: 'a' }, { setName: (s, p) => ({ ...s, name: p.n }) }] },
    selectors: { userName: [(s) => s.user, (u) => u.name] }
  })
  logic.mount()
  typeof logic.selectorHealth === 'function'
  ```
  If this check returns false, you have not attached `selectorHealth` to the wrapper in `src/kea/kea.ts`. Fix it before finishing.
- Do not finish until both checks pass and the focused atomic tests pass.
