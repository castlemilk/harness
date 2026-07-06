---
name: kea-atomic-selectors
description: TypeScript Kea framework - add the Atomic Signal Selector Engine with dependency tracking, circular detection, and React integration.
args: []
---

# Kea Atomic Signal Selector Engine

When a task asks you to add atomic/signal selectors to Kea, implement the **Atomic Signal Selector Engine** described below. This is a framework-level wiring task: you will create one new file (`src/kea/atomic.ts`) and make small, targeted edits in `src/kea/context.ts`, `src/core/selectors.ts`, `src/core/reducers.ts`, `src/core/index.ts`, `src/kea/kea.ts`, `src/react/hooks.ts`, and `src/types.ts`. Do not create or modify test files.

## What NOT to do

- Do NOT create or modify test files. The verifier supplies its own tests.
- Do NOT modify `rollup.config.js`, `tsconfig.json`, or build tooling unless explicitly required.
- Do NOT break baseline Kea behavior. Keep existing selector memoization and React/Redux integration intact.

## Verification commands

After every wiring step, run the focused atomic tests:

```bash
pnpm test:jest -- atomic
```

Fix the first failing test before moving on. Do NOT set `BABEL_ENV` manually; the npm script handles it.

Before calling `finish`, you MUST call `validate_patch` and `verify_api_surface` with `entry: 'src/index.ts'` and this exact check:

```js
const { kea, resetContext } = require('./src/index.ts'); resetContext({ atomicSelectors: true }); const logic = kea({ actions: { setName: (n) => ({ n }) }, reducers: { user: [(s) => s || { name: 'a' }, { setName: (s, p) => ({ ...s, name: p.n }) }] }, selectors: { userName: [(s) => s.user, (u) => u.name] } }); logic.mount(); console.log(typeof logic.selectorHealth === 'function')
```

## Step 1 — Context option

Edit `src/kea/context.ts`.

1. Add `atomicSelectors: false` to the default options merge inside `openContext`.
2. After `runPlugins('afterOpenContext', newContext, options)`, if `newContext.options.atomicSelectors` is true, dynamically require `initAtomicContext` from `./atomic` and call it.

## Step 2 — Types

Edit `src/types.ts`.

1. Add `selectorHealth?: () => AtomicSelectorHealth` to the `Logic` interface.
2. Add `selectorHealth?: () => AtomicSelectorHealth` to `MakeLogicType`.
3. Add `atomicSelectors: boolean` to `InternalContextOptions`.
4. Append the `AtomicSelectorHealth` interface at the bottom of the file:

```ts
export interface AtomicSelectorHealth {
  selectors: Record<
    string,
    {
      dependencies: string[]
      evaluations: number
      dirtyCause?: string | null
      dependents?: string[]
    }
  >
  topologicalOrder?: string[]
}
```

## Step 3 — Atomic engine file

Create `src/kea/atomic.ts` with the implementation below. This is the core engine; do not simplify it.

```ts
import { getContext, getPluginContext, getStoreState } from './context'
import { BuiltLogic, Logic, Selector, AtomicSelectorHealth } from '../types'
import { shallowCompare } from '../utils'

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
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  let pathMap = proxyCache.get(obj)
  if (!pathMap) {
    pathMap = new Map()
    proxyCache.set(obj, pathMap)
  }
  if (pathMap.has(path)) {
    return pathMap.get(path)
  }

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
            return (...args: any[]) => {
              return value.apply(proxy, args)
            }
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
        if (key === 'toJSON' || key === 'constructor' || typeof prop === 'symbol') {
          return target[prop]
        }
        const fullPath = path ? `${path}.${key}` : key
        if (globalTrackingSet) {
          globalTrackingSet.add(fullPath)
        }
        const value = target[prop]
        if (typeof value === 'object' && value !== null) {
          return createProxy(value, fullPath)
        }
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
      if (hasCircularDependencyKey(targetKey, depKey, visited)) {
        return true
      }
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
      if (listeners) {
        listeners.forEach(cb => cb())
      }
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

          const wildcards = [
            currentPath + '.*',
            currentPath + '.map:*',
            currentPath + '.set:*'
          ]
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
      if (!oldObj.has(key) || !newObj.has(key)) {
        paths.push(fullPath)
      }
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
  return () => {
    listeners!.delete(callback)
  }
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
      for (const dep of dependents) {
        visit(getOriginal(dep))
      }
    }
    const metadata = atomicContext.selectorMetadata.get(s)
    if (metadata) stack.push(metadata.name)
  }

  for (const selector of atomicContext.selectorMetadata.keys()) {
    visit(selector)
  }
  return stack.reverse()
}

export function getLogicSelectorHealth(logic: Logic): AtomicSelectorHealth {
  const atomicContext = getAtomicContext()
  const health: AtomicSelectorHealth = {
    selectors: {},
    topologicalOrder: getTopologicalOrder()
  }

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

1. Import `getContext` from `../kea/context` if not already imported.
2. In the selector builder, after validating `args`, build the selector like this:

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

## Step 5 — Wire reducer selectors

Edit `src/core/reducers.ts`.

1. Import `getContext` from `../kea/context`.
2. Where reducer selectors are created with `createSelector(logic.selector!, (state) => state[key])`, wrap them when atomic mode is enabled:

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
2. In the reducers plugin (around where `previousState` is captured and the response is returned), after the reducer runs, if atomic selectors are enabled and the store state changed, call `updateAtomicSignals`:

```ts
const { options: contextOptions } = getContext()
if (contextOptions.atomicSelectors && previousState !== store.getState()) {
  const { updateAtomicSignals } = require('../kea/atomic')
  updateAtomicSignals(previousState, store.getState())
}
```

## Step 7 — Wrapper selectorHealth proxy

Edit `src/kea/kea.ts`.

Add `'selectorHealth'` to the `reservedProxiedKeys` array in `proxyFields` so the wrapper exposes the built logic's `selectorHealth` method.

## Step 8 — React integration

Edit `src/react/hooks.ts`.

Modify `useSelector` so that when atomic selectors are enabled and the selector has `_atomic: true`, it subscribes to atomic signals instead of the whole store:

```ts
export function useSelector(selector: Selector): any {
  const { store, options } = getContext() || { options: {} }
  const subscribe = useMemo(() => {
    if (options.atomicSelectors && (selector as any)._atomic) {
      const { subscribeToAtomicSelector } = require('../kea/atomic')
      return (cb: () => void) => subscribeToAtomicSelector(selector, cb)
    }
    return store?.subscribe || (() => () => {})
  }, [selector, options.atomicSelectors, store])

  return useSyncExternalStore(subscribe, () => selector(getStoreState()))
}
```

## Step 9 — Final verification

Run the focused atomic tests:

```bash
pnpm test:jest -- atomic
```

Then call `validate_patch` and `verify_api_surface` with the check from the top of this skill. Do not finish until all checks pass.
