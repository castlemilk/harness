---
name: kea-atomic-selectors
description: TypeScript Kea framework - add the Atomic Signal Selector Engine with dependency tracking, circular detection, and React integration.
args: []
---

# Kea Atomic Signal Selector Engine

Implement the engine by creating `src/kea/atomic.ts` and editing `src/kea/context.ts`, `src/types.ts`, `src/core/selectors.ts`, `src/core/reducers.ts`, `src/core/index.ts`, `src/kea/kea.ts`, and `src/react/hooks.ts`. Do not create or modify test files.

## CRITICAL: Do not skip these three edits

| File | Why it matters | Symptom if skipped |
|---|---|---|
| `src/core/selectors.ts` | Keep `addSelectorAndValue` exported; `src/core/reducers.ts` imports it. | `addSelectorAndValue is not a function` |
| `src/kea/kea.ts` | Add `'selectorHealth'` to `reservedProxiedKeys` so `logic.selectorHealth()` works. | `logic.selectorHealth is not a function` |
| `src/react/hooks.ts` | Subscribe to atomic signals so React re-renders on relevant changes. | React re-render test fails, score ~0.993 |

## Verification commands

Run focused tests after each wiring step:

```bash
pnpm test:jest -- atomic
```

Before calling `finish`, run each of these checks individually (a non-zero exit means that check failed):

```bash
grep -q "export function addSelectorAndValue" src/core/selectors.ts
grep -q "selectorHealth" src/kea/kea.ts
grep -q "subscribeToAtomicSelector" src/react/hooks.ts
```

After editing `src/types.ts`, `grep -c "selectorHealth" src/types.ts` should print exactly `2` (one in the `Logic` interface and one in `MakeLogicType`). If the count is higher, remove duplicates before proceeding.

Then call `validate_patch` and `verify_api_surface` with `entry: 'src/index.ts'` and this exact check:

```js
const { kea, resetContext } = require('./src/index.ts'); resetContext({ atomicSelectors: true }); const logic = kea({ actions: { setName: (n) => ({ n }) }, reducers: { user: [(s) => s || { name: 'a' }, { setName: (s, p) => ({ ...s, name: p.n }) }] }, selectors: { userName: [(s) => s.user, (u) => u.name] } }); logic.mount(); console.log(typeof logic.selectorHealth === 'function')
```

## Step 1 — Context option

Edit `src/kea/context.ts`.

1. Add `atomicSelectors: false` to the default options merge inside `openContext`.
2. After `runPlugins('afterOpenContext', newContext, options)`, if `newContext.options.atomicSelectors` is true, dynamically require `initAtomicContext` from `./atomic` and call it.

## Step 2 — Types

Edit `src/types.ts`.

1. Add `selectorHealth?: () => any` to the `Logic` interface. Use this exact `edit_file`:

```ts
old_string:
  selector?: Selector
  selectors: Record<string, Selector>
  values: Record<string, any>
  events: {
new_string:
  selector?: Selector
  selectors: Record<string, Selector>
  values: Record<string, any>
  selectorHealth?: () => any
  events: {
```

2. Add `selectorHealth?: () => any` to `MakeLogicType` (search for `export interface MakeLogicType`). Use this exact `edit_file`:

```ts
old_string:
  selector: (state: any, props: LogicProps) => Values
  selectors: {
    [Value in keyof Values]: (state: any, props: LogicProps) => Values[Value]
  }
  values: Values
new_string:
  selector: (state: any, props: LogicProps) => Values
  selectors: {
    [Value in keyof Values]: (state: any, props: LogicProps) => Values[Value]
  }
  values: Values
  selectorHealth?: () => any
```

3. Add `atomicSelectors: boolean` to `InternalContextOptions`. Use this exact `edit_file`:

```ts
old_string:
export interface InternalContextOptions {
  debug: boolean
  proxyFields: boolean
  flatDefaults: boolean
  attachStrategy: 'dispatch' | 'replace'
  detachStrategy: 'dispatch' | 'replace' | 'persist'
  defaultPath: string[]
  disableAsyncActions: boolean
  // ...otherOptions
}
new_string:
export interface InternalContextOptions {
  debug: boolean
  proxyFields: boolean
  flatDefaults: boolean
  attachStrategy: 'dispatch' | 'replace'
  detachStrategy: 'dispatch' | 'replace' | 'persist'
  defaultPath: string[]
  disableAsyncActions: boolean
  atomicSelectors: boolean
  // ...otherOptions
}
```

**Do NOT** add `selectorHealth` to `LogicWrapperAdditions` or `BuiltLogicAdditions`; those types inherit from `Logic`, so a single declaration on `Logic` is enough.

## Step 3 — Atomic engine file

Create `src/kea/atomic.ts` with the implementation below. Use `write_file`. Do not simplify the logic.

```ts
import { getContext, getPluginContext, getStoreState } from './context'
import { BuiltLogic, Logic, Selector } from '../types'
import { shallowCompare } from '../utils'

export interface AtomicSelectorHealth {
  selectors: Record<string, { dependencies: string[]; evaluations: number; dirtyCause?: string | null; dependents?: string[] }>
  topologicalOrder?: string[]
}

export interface AtomicMetadata {
  evaluations: number
  dependencies: Set<string>
  logic: Logic
  name: string
  compute: Selector
  lastValue?: any
  lastProps?: any
  dirtyCause?: string | null
}

export interface AtomicPluginContext {
  leafToSelectors: Map<string, Set<Selector>>
  selectorToSelectors: Map<Selector, Set<Selector>>
  selectorMetadata: Map<Selector, AtomicMetadata>
  listeners: Map<Selector, Set<() => void>>
  dirtySelectors: Set<Selector>
  activeSelector: Selector | null
}

export function getAtomicContext(): AtomicPluginContext {
  return getPluginContext<AtomicPluginContext>('atomic')
}

export function initAtomicContext(): void {
  const { plugins } = getContext()
  metadataByKey.clear()
  selectorToSelectorsKeys.clear()
  keyToSelector.clear()
  if (!plugins.contexts.atomic) {
    plugins.contexts.atomic = {
      leafToSelectors: new Map(),
      selectorToSelectors: new Map(),
      selectorMetadata: new Map(),
      listeners: new Map(),
      dirtySelectors: new Set(),
      activeSelector: null,
    }
  }
}

const proxyStateCache = new WeakMap<any, any>()
const proxyCache = new WeakMap<any, Map<string, any>>()
let globalTrackingSet: Set<string> | null = null

function createProxy(obj: any, path: string): any {
  if (typeof obj !== 'object' || obj === null) return obj
  let pathMap = proxyCache.get(obj)
  if (!pathMap) {
    pathMap = new Map()
    proxyCache.set(obj, pathMap)
  }
  if (pathMap.has(path)) return pathMap.get(path)

  let proxy: any
  if (Array.isArray(obj)) {
    proxy = new Proxy(obj, {
      get(target, prop) {
        const value = (target as any)[prop]
        if (typeof prop === 'string') {
          if (!isNaN(Number(prop))) {
            const fullPath = path ? `${path}.${prop}` : prop
            if (globalTrackingSet) globalTrackingSet.add(fullPath)
            return createProxy(value, fullPath)
          }
          if (['map', 'filter', 'reduce', 'forEach', 'every', 'some', 'flatMap'].includes(prop)) {
            return (...args: any[]) => {
              const fullPath = path ? `${path}.*` : '*'
              if (globalTrackingSet) globalTrackingSet.add(fullPath)
              return value.apply(proxy, args)
            }
          }
          if (prop === 'length') {
            const fullPath = path ? `${path}.length` : 'length'
            if (globalTrackingSet) globalTrackingSet.add(fullPath)
            return target.length
          }
          if (['includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'concat', 'find', 'findIndex'].includes(prop)) {
            return (...args: any[]) => value.apply(proxy, args)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  } else if (obj instanceof Map) {
    proxy = new Proxy(obj, {
      get(target, prop) {
        const value = (target as any)[prop]
        if (typeof prop === 'string') {
          if (['get', 'has'].includes(prop)) {
            return (key: any) => {
              const fullPath = path ? `${path}.map:${key}` : `map:${key}`
              if (globalTrackingSet) globalTrackingSet.add(fullPath)
              const result = target.get(key)
              return createProxy(result, fullPath)
            }
          }
          if (['keys', 'values', 'entries', Symbol.iterator].includes(prop as any)) {
            return (...args: any[]) => {
              const fullPath = path ? `${path}.map:*` : 'map:*'
              if (globalTrackingSet) globalTrackingSet.add(fullPath)
              return value.apply(target, args)
            }
          }
          if (prop === 'size') {
            const fullPath = path ? `${path}.map:*` : 'map:*'
            if (globalTrackingSet) globalTrackingSet.add(fullPath)
            return target.size
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  } else if (obj instanceof Set) {
    proxy = new Proxy(obj, {
      get(target, prop) {
        const value = (target as any)[prop]
        if (typeof prop === 'string') {
          if (prop === 'has') {
            return (key: any) => {
              const fullPath = path ? `${path}.set:${key}` : `set:${key}`
              if (globalTrackingSet) globalTrackingSet.add(fullPath)
              return target.has(key)
            }
          }
          if (['keys', 'values', 'entries', Symbol.iterator, 'forEach'].includes(prop as any)) {
            return (...args: any[]) => {
              const fullPath = path ? `${path}.set:*` : 'set:*'
              if (globalTrackingSet) globalTrackingSet.add(fullPath)
              return value.apply(target, args)
            }
          }
          if (prop === 'size') {
            const fullPath = path ? `${path}.set:*` : 'set:*'
            if (globalTrackingSet) globalTrackingSet.add(fullPath)
            return target.size
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  } else {
    proxy = new Proxy(obj, {
      get(target, prop) {
        const key = String(prop)
        if (key === 'toJSON' || key === 'constructor' || typeof prop === 'symbol') return target[prop]
        const fullPath = path ? `${path}.${key}` : key
        if (globalTrackingSet) globalTrackingSet.add(fullPath)
        const value = target[prop]
        if (typeof value === 'object' && value !== null) return createProxy(value, fullPath)
        return value
      }
    })
  }

  pathMap.set(path, proxy)
  return proxy
}

function getOriginal(s: any): Selector {
  const visited = new Set<any>()
  while (s && s._original && !visited.has(s)) {
    visited.add(s)
    s = s._original
  }
  return s
}

const metadataByKey = new Map<string, AtomicMetadata>()
const selectorToSelectorsKeys = new Map<string, Set<string>>()
const keyToSelector = new Map<string, Selector>()

function hasCircularDependencyKey(targetKey: string, startKey: string, visited = new Set<string>()): boolean {
  if (targetKey === startKey) return true
  if (visited.has(startKey)) return false
  visited.add(startKey)
  const dependents = selectorToSelectorsKeys.get(startKey)
  if (dependents) {
    for (const depKey of dependents) {
      if (hasCircularDependencyKey(targetKey, depKey, visited)) return true
    }
  }
  return false
}

export function wrapAtomicSelector(
  logic: Logic,
  name: string,
  reselectSelector: Selector,
  inputSelectors: Selector[]
): { wrappedSelector: Selector; metadata: AtomicMetadata } {
  const atomicContext = getAtomicContext()
  const metadataKey = `${logic.pathString}:${name}`
  const originalSelector = getOriginal(reselectSelector)
  let metadata: AtomicMetadata

  if (metadataByKey.has(metadataKey)) {
    const existingMetadata = metadataByKey.get(metadataKey)!
    atomicContext.selectorMetadata.set(originalSelector, existingMetadata)
    metadata = existingMetadata
  } else {
    metadata = {
      evaluations: 0,
      dependencies: new Set<string>(),
      logic,
      name,
      compute: originalSelector,
      dirtyCause: null
    }
    metadataByKey.set(metadataKey, metadata)
    atomicContext.selectorMetadata.set(originalSelector, metadata)
    keyToSelector.set(metadataKey, originalSelector)
  }

  for (const inputSelector of inputSelectors) {
    const inputName = Object.keys(logic.selectors).find(k => logic.selectors[k] === inputSelector)
    if (inputName) {
      const inputKey = `${logic.pathString}:${inputName}`
      if (inputKey !== metadataKey) {
        let dependents = selectorToSelectorsKeys.get(inputKey)
        if (!dependents) {
          dependents = new Set()
          selectorToSelectorsKeys.set(inputKey, dependents)
        }
        dependents.add(metadataKey)

        if (hasCircularDependencyKey(inputKey, metadataKey)) {
          throw new Error(`[KEA] Circular dependency detected: ${name}`)
        }

        const originalInput = getOriginal(inputSelector)
        let funcDependents = atomicContext.selectorToSelectors.get(originalInput)
        if (!funcDependents) {
          funcDependents = new Set()
          atomicContext.selectorToSelectors.set(originalInput, funcDependents)
        }
        funcDependents.add(originalSelector)
      }
    }
  }

  const wrappedSelector = (state: any, props: any) => {
    const atomicContext = getAtomicContext()

    if (metadata.evaluations > 0 &&
        !atomicContext.dirtySelectors.has(originalSelector) &&
        shallowCompare(metadata.lastProps, props)) {
      return metadata.lastValue
    }

    atomicContext.dirtySelectors.delete(originalSelector)
    metadata.evaluations++
    metadata.lastProps = props

    const oldTrackingSet = globalTrackingSet
    const myTrackingSet = new Set<string>()
    globalTrackingSet = myTrackingSet

    try {
      let proxyState = proxyStateCache.get(state)
      if (!proxyState) {
        proxyState = createProxy(state, '')
        proxyStateCache.set(state, proxyState)
      }

      const result = reselectSelector(proxyState, props)
      metadata.lastValue = result

      const pathsArray = Array.from(myTrackingSet)
      const finalPaths = pathsArray.filter(path => {
        return !pathsArray.some(other => other !== path && other.startsWith(path + '.'))
      })

      const logicPathPrefix = logic.pathString + '.'
      for (const path of finalPaths) {
        const relativePath = path.startsWith(logicPathPrefix) ? path.slice(logicPathPrefix.length) : path
        metadata.dependencies.add(relativePath)

        let selectors = atomicContext.leafToSelectors.get(path)
        if (!selectors) {
          selectors = new Set()
          atomicContext.leafToSelectors.set(path, selectors)
        }
        selectors.add(originalSelector)
      }

      for (const inputSelector of inputSelectors) {
        const inputName = Object.keys(logic.selectors).find(k => logic.selectors[k] === inputSelector)
        if (inputName) {
          const isReducer = !!logic.reducers[inputName]
          if (!isReducer || !finalPaths.some(p => p.startsWith(logicPathPrefix + inputName + '.'))) {
            metadata.dependencies.add(inputName)
          }
        }
      }

      return result
    } finally {
      globalTrackingSet = oldTrackingSet
    }
  }

  ;(wrappedSelector as any)._atomic = true
  ;(wrappedSelector as any)._original = originalSelector

  return { wrappedSelector, metadata }
}

export class AtomicScheduler {
  private context: AtomicPluginContext
  private isUpdating = false

  constructor() {
    this.context = getAtomicContext()
  }

  markDirty(selector: Selector, cause: string): void {
    const original = getOriginal(selector)
    if (!this.context.dirtySelectors.has(original)) {
      this.context.dirtySelectors.add(original)
      const metadata = this.context.selectorMetadata.get(original)
      if (metadata) {
        const prefix = metadata.logic.pathString + '.'
        metadata.dirtyCause = cause.startsWith(prefix) ? cause.slice(prefix.length) : cause
      }
    }
  }

  propagate(queue: Selector[]): void {
    let head = 0
    while (head < queue.length) {
      const selector = queue[head++]
      const dependents = this.context.selectorToSelectors.get(selector)
      if (dependents) {
        for (const dep of dependents) {
          const originalDep = getOriginal(dep)
          if (!this.context.dirtySelectors.has(originalDep)) {
            this.markDirty(originalDep, `selector:${this.context.selectorMetadata.get(selector)?.name || 'unknown'}`)
            queue.push(originalDep)
          }
        }
      }
    }
  }

  notify(): void {
    for (const selector of this.context.dirtySelectors) {
      const listeners = this.context.listeners.get(selector)
      if (listeners) listeners.forEach(cb => cb())
    }
  }

  runSignals(previousState: any, newState: any): void {
    const changedPaths = findChangedPaths(previousState, newState)
    if (changedPaths.length === 0 || this.isUpdating) return

    this.isUpdating = true
    try {
      const queue: Selector[] = []
      for (const path of changedPaths) {
        let currentPath = path
        let isExact = true
        while (true) {
          let selectors = this.context.leafToSelectors.get(currentPath)
          if (selectors) {
            for (const s of selectors) {
              const original = getOriginal(s)
              if (!this.context.dirtySelectors.has(original)) {
                this.markDirty(original, path)
                if (isExact) queue.push(original)
              }
            }
          }

          const wildcards = [currentPath + '.*', currentPath + '.map:*', currentPath + '.set:*']
          for (const wc of wildcards) {
            selectors = this.context.leafToSelectors.get(wc)
            if (selectors) {
              for (const s of selectors) {
                const original = getOriginal(s)
                if (!this.context.dirtySelectors.has(original)) {
                  this.markDirty(original, path)
                  if (isExact) queue.push(original)
                }
              }
            }
          }

          const lastDot = currentPath.lastIndexOf('.')
          if (lastDot === -1) {
            ['*', 'map:*', 'set:*'].forEach(wc => {
              const rootSelectors = this.context.leafToSelectors.get(wc)
              if (rootSelectors) {
                for (const s of rootSelectors) {
                  const original = getOriginal(s)
                  if (!this.context.dirtySelectors.has(original)) {
                    this.markDirty(original, path)
                    if (isExact) queue.push(original)
                  }
                }
              }
            })
            break
          }
          currentPath = currentPath.slice(0, lastDot)
          isExact = false
        }
      }
      this.propagate(queue)
      this.notify()
    } finally {
      this.isUpdating = false
    }
  }
}

export function updateAtomicSignals(previousState: any, newState: any): void {
  new AtomicScheduler().runSignals(previousState, newState)
}

function findChangedPaths(oldObj: any, newObj: any, path = ''): string[] {
  if (oldObj === newObj) return []
  if (oldObj instanceof Map && newObj instanceof Map) {
    const paths: string[] = []
    const keys = new Set([...oldObj.keys(), ...newObj.keys()])
    for (const key of keys) {
      const fullPath = path ? `${path}.map:${key}` : `map:${key}`
      if (oldObj.get(key) !== newObj.get(key)) {
        paths.push(...findChangedPaths(oldObj.get(key), newObj.get(key), fullPath))
      }
    }
    return paths
  }
  if (oldObj instanceof Set && newObj instanceof Set) {
    const paths: string[] = []
    const keys = new Set([...oldObj, ...newObj])
    for (const key of keys) {
      const fullPath = path ? `${path}.set:${key}` : `set:${key}`
      if (!oldObj.has(key) || !newObj.has(key)) paths.push(fullPath)
    }
    return paths
  }
  if (typeof oldObj !== 'object' || oldObj === null || typeof newObj !== 'object' || newObj === null) {
    return [path]
  }

  const paths: string[] = []
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  for (const key of keys) {
    const fullPath = path ? `${path}.${key}` : key
    paths.push(...findChangedPaths(oldObj[key], newObj[key], fullPath))
  }
  return paths
}

export function subscribeToAtomicSelector(selector: Selector, callback: () => void): () => void {
  const atomicContext = getAtomicContext()
  const original = getOriginal(selector)
  let listeners = atomicContext.listeners.get(original)
  if (!listeners) {
    listeners = new Set()
    atomicContext.listeners.set(original, listeners)
  }
  listeners.add(callback)
  return () => { listeners!.delete(callback) }
}

export function getTopologicalOrder(): string[] {
  const atomicContext = getAtomicContext()
  const visited = new Set<Selector>()
  const stack: string[] = []

  function visit(s: Selector) {
    if (visited.has(s)) return
    visited.add(s)
    const dependents = atomicContext.selectorToSelectors.get(s)
    if (dependents) {
      for (const dep of dependents) visit(getOriginal(dep))
    }
    const metadata = atomicContext.selectorMetadata.get(s)
    if (metadata) stack.push(metadata.name)
  }

  for (const selector of atomicContext.selectorMetadata.keys()) visit(selector)
  return stack.reverse()
}

export function getLogicSelectorHealth(logic: Logic): AtomicSelectorHealth {
  const atomicContext = getAtomicContext()
  const health: AtomicSelectorHealth = { selectors: {}, topologicalOrder: getTopologicalOrder() }

  for (const [key, selector] of Object.entries(logic.selectors)) {
    const original = getOriginal(selector)
    let metadata = atomicContext.selectorMetadata.get(original)
    if (metadata) {
      const dependents = atomicContext.selectorToSelectors.get(original)
      health.selectors[key] = {
        dependencies: Array.from(metadata.dependencies),
        evaluations: metadata.evaluations,
        dirtyCause: metadata.dirtyCause,
        dependents: dependents ? Array.from(dependents).map(d => {
          const m = atomicContext.selectorMetadata.get(getOriginal(d))
          return m ? m.name : 'unknown'
        }) : []
      }
    }
  }

  return health
}
```

## Step 4 — Wire selector creation

Edit `src/core/selectors.ts`.

1. Import `getContext` from `../kea/context`.
2. In the selector builder, replace the `builtSelectors[key] = createSelector(...)` and `addSelectorAndValue(...)` block with:

```ts
let atomicMetadata: any = null
const wrappedFunc = (...funcArgs: any[]) => func(...funcArgs)
let finalSelector = createSelector(args, wrappedFunc, { memoizeOptions })

const options = getContext()?.options || { atomicSelectors: false }
if (options.atomicSelectors) {
  const { wrapAtomicSelector, getLogicSelectorHealth } = require('../kea/atomic')
  const result = wrapAtomicSelector(logic, key, finalSelector, args)
  atomicMetadata = result.metadata
  finalSelector = result.wrappedSelector
  if (!logic.selectorHealth) {
    logic.selectorHealth = () => getLogicSelectorHealth(logic)
  }
}

builtSelectors[key] = finalSelector

const selectorToRegister: any = (state = getStoreState(), props = logic.props) =>
  builtSelectors[key](state, props)

if (options.atomicSelectors) {
  selectorToRegister._original = finalSelector
  selectorToRegister._atomic = true
}

addSelectorAndValue(logic, key, selectorToRegister)
```

**CRITICAL:** Do not remove the `export` from `addSelectorAndValue` in this file. `src/core/reducers.ts` imports it.

## Step 5 — Wire reducer selectors

Edit `src/core/reducers.ts`.

1. Import `getContext` from `../kea/context`.
2. Where reducer selectors are created, replace:

```ts
addSelectorAndValue(
  logic,
  key,
  createSelector(logic.selector!, (state) => state[key]),
)
```

with:

```ts
let finalSelector = createSelector(logic.selector!, (state) => state[key])
const { options } = getContext()
if (options.atomicSelectors) {
  const { wrapAtomicSelector, getLogicSelectorHealth } = require('../kea/atomic')
  const result = wrapAtomicSelector(logic, key, finalSelector, [logic.selector!])
  finalSelector = result.wrappedSelector
  if (!logic.selectorHealth) {
    logic.selectorHealth = () => getLogicSelectorHealth(logic)
  }
}
const selectorToRegister: any = finalSelector
if (options.atomicSelectors) {
  selectorToRegister._atomic = true
}
addSelectorAndValue(logic, key, selectorToRegister)
```

## Step 6 — Signal propagation after reducer updates

Edit `src/core/index.ts`.

1. Import `getContext` from `../kea/context`.
2. In the reducers plugin middleware, after the reducer runs, if atomic selectors are enabled and the store state changed, call `updateAtomicSignals`:

```ts
const { options: contextOptions } = getContext()
if (contextOptions.atomicSelectors && previousState !== store.getState()) {
  const { updateAtomicSignals } = require('../kea/atomic')
  updateAtomicSignals(previousState, store.getState())
}
```

## Step 7 — Wrapper selectorHealth proxy (REQUIRED)

Edit `src/kea/kea.ts`.

Add `'selectorHealth'` to the `reservedProxiedKeys` array in `proxyFields`. Without this `logic.selectorHealth()` is undefined.

## Step 8 — React integration (REQUIRED)

Edit `src/react/hooks.ts`. This is mandatory. Without it the React re-render test fails.

1. Add a helper to subscribe to atomic signals:

```ts
function subscribeAtomicSelector(selector: Selector, callback: () => void): () => void {
  const { subscribeToAtomicSelector } = require('../kea/atomic')
  return subscribeToAtomicSelector(selector, callback)
}
```

2. Replace `useSelector` with:

```ts
export function useSelector(selector: Selector): any {
  const context = getContext()
  const isAtomic = context.options.atomicSelectors && (selector as any)._atomic
  return useSyncExternalStore(
    isAtomic ? (cb) => subscribeAtomicSelector(selector, cb) : context.store.subscribe,
    () => selector(getStoreState()),
  )
}
```

## Step 9 — Final verification

Run:

```bash
pnpm test:jest -- atomic
```

Then run the two grep checks from the top of this skill. Then call `validate_patch` and `verify_api_surface`. Do not finish until all checks pass.
