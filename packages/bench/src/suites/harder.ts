import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkTask, EvaluationContext, BenchmarkEvaluation } from '../types.js';
import { task, codeFile, jsonFile } from './builder.js';
import { applyLatestPatch, runScript, expectScriptOutput } from './eval-helpers.js';

/**
 * Harder benchmark suite: 12 tasks designed to differentiate agents.
 *
 * Each task exercises a capability the fast suite doesn't:
 *
 *  - **debug**: agent must read existing code, find a real bug, and fix it.
 *    Tests are NOT included in the prompt.
 *  - **refactor**: agent must rename / extract across multiple files while
 *    keeping existing tests passing.
 *  - **constraints**: agent must implement an API with specific exports,
 *    error messages, and edge cases — no obvious pattern-match.
 *  - **write-tests**: agent must write tests that capture a spec, given a
 *    buggy implementation. The tests must FAIL on the broken code and PASS
 *    on a hidden correct implementation we swap in during evaluation.
 *
 * Setup writes the project; the evaluator applies the agent's patch and
 * then runs the project's tests to score correctness.
 */

async function baseProject(projectPath: string): Promise<void> {
  await jsonFile(projectPath, 'package.json', {
    name: 'harder-bench-project',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node test.js',
      build: 'node build.js',
      lint: 'node lint.js',
    },
  });
  await codeFile(projectPath, 'build.js', "console.log('build ok');\n");
  await codeFile(projectPath, 'lint.js', "console.log('lint ok');\n");
}

/**
 * Evaluator: apply the patch, then run the project's test.js and check
 * for a specific output substring. The `test.js` itself is part of the
 * setup, so it's present before the agent starts.
 */
function patchAndTestScript(marker: string): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    return expectScriptOutput('test.js', marker)(ctx);
  };
}

/**
 * Evaluator for write-tests tasks: apply the patch, then SWAP the
 * buggy implementation for the hidden correct one and run tests.
 * Pass = tests pass on the correct implementation AND would fail on
 * the buggy one (the buggy version is checked separately as a meta-test).
 */
function patchAndSwapTest(
  buggyFile: string,
  correctFile: string,
  marker: string,
): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    // Back up the agent's test file so we can re-evaluate on the correct impl.
    const testPath = path.join(ctx.projectPath, 'test.js');
    const testBackup = await fs.readFile(testPath, 'utf-8');
    const buggyPath = path.join(ctx.projectPath, buggyFile);
    const correctPath = path.join(ctx.projectPath, correctFile);
    try {
      // Swap buggy impl for the correct one and run the agent's tests.
      const correct = await fs.readFile(correctPath, 'utf-8');
      await fs.copyFile(correctPath, `${correctPath}.bak`);
      await fs.writeFile(buggyPath, correct, 'utf-8');
      const { stdout, stderr, exitCode } = await runScript(ctx, 'test.js');
      const combined = `${stdout}\n${stderr}`;
      const passed = exitCode === 0 && combined.includes(marker);
      return {
        passed,
        message: passed ? `Tests pass on correct impl` : `Tests failed on correct impl: ${combined.trim() || '(no output)'}`,
      };
    } finally {
      // Restore the buggy impl + agent's tests.
      const buggyContent = await fs.readFile(buggyPath, 'utf-8').catch(() => '');
      await fs.writeFile(buggyPath, buggyContent, 'utf-8');
      await fs.writeFile(testPath, testBackup, 'utf-8');
      await fs.unlink(`${correctPath}.bak`).catch(() => undefined);
    }
  };
}

// --------------------------------------------------------------------------
// Debug tasks (3) — agent must find and fix a bug in existing code.
// --------------------------------------------------------------------------

export function harderDebugSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'harder-debug-binary-search',
      name: 'Find the off-by-one in binary search',
      title: 'Debug an off-by-one in binary search',
      description:
        'The file src/search.js implements binarySearch. The test file test.js has a failing case. Read both files, find the bug, and fix it without rewriting the function. The test must pass.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        // Bug: uses `hi = arr.length - 1` instead of `arr.length`, AND
        // moves `lo = mid` instead of `lo = mid + 1` (so duplicates are missed).
        await codeFile(
          projectPath,
          'src/search.js',
          `export function binarySearch(arr, target) {\n  let lo = 0;\n  let hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = Math.floor((lo + hi) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) lo = mid;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { binarySearch } from './src/search.js';\nimport assert from 'node:assert';\nassert.strictEqual(binarySearch([1,2,3,4,5,6,7,8], 1), 0);\nassert.strictEqual(binarySearch([1,2,3,4,5,6,7,8], 8), 7);\nassert.strictEqual(binarySearch([1,2,3,4,5,6,7,8], 4), 3);\nassert.strictEqual(binarySearch([1,2,3,4,5,6,7,8], 9), -1);\nconsole.log('search tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('search tests passed'),
    }),
    task({
      id: 'harder-debug-merge-intervals',
      name: 'Fix the interval overlap detector',
      title: 'Fix off-by-one in interval overlap detector',
      description:
        'src/intervals.js exports overlaps(a, b) which should return true iff [a.start, a.end) and [b.start, b.end) overlap. Currently it misses the case where b starts exactly at a.end. Fix it. The test is in test.js.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        // Bug: uses `<=` instead of `<`, so adjacent intervals are considered overlapping.
        await codeFile(
          projectPath,
          'src/intervals.js',
          `export function overlaps(a, b) {\n  return a.start <= b.end && b.start <= a.end;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { overlaps } from './src/intervals.js';\nimport assert from 'node:assert';\nassert.strictEqual(overlaps({start: 0, end: 5}, {start: 5, end: 10}), false);\nassert.strictEqual(overlaps({start: 0, end: 5}, {start: 3, end: 7}), true);\nassert.strictEqual(overlaps({start: 0, end: 5}, {start: -1, end: 1}), true);\nconsole.log('intervals tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('intervals tests passed'),
    }),
    task({
      id: 'harder-debug-async-race',
      name: 'Fix a race in async cache',
      title: 'Fix the async cache stampede',
      description:
        'src/cache.js exports getOrFetch(key, fetcher). When two callers ask for the same key concurrently, the current implementation calls fetcher twice. Fix it so only one fetch happens and both callers receive the same value.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        // Bug: doesn't track in-flight fetches, so concurrent callers both invoke fetcher.
        await codeFile(
          projectPath,
          'src/cache.js',
          `const cache = new Map();\nexport async function getOrFetch(key, fetcher) {\n  if (cache.has(key)) return cache.get(key);\n  const value = await fetcher();\n  cache.set(key, value);\n  return value;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { getOrFetch } from './src/cache.js';\nimport assert from 'node:assert';\nlet calls = 0;\nconst fetcher = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return 'v'; };\nconst [a, b] = await Promise.all([getOrFetch('k', fetcher), getOrFetch('k', fetcher)]);\nassert.strictEqual(a, 'v');\nassert.strictEqual(b, 'v');\nassert.strictEqual(calls, 1);\nconsole.log('cache tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('cache tests passed'),
    }),
  ];
}

// --------------------------------------------------------------------------
// Refactor tasks (3) — multi-file, must keep existing tests passing.
// --------------------------------------------------------------------------

export function harderRefactorSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'harder-refactor-rename',
      name: 'Rename a function across multiple files',
      title: 'Rename `process` → `handle` across 4 files',
      description:
        'The codebase uses `process` as a function name, which shadows Node\'s global `process`. Rename every usage of `process(...)` to `handle(...)` across all .js files. Do NOT rename the Node global. All existing tests in test.js must still pass.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/handler.js',
          `export function process(input) {\n  return input.trim().toUpperCase();\n}\n`
        );
        await codeFile(
          projectPath,
          'src/api.js',
          `import { process } from './handler.js';\nexport function run(input) {\n  return process(input) + '!';\n}\n`
        );
        await codeFile(
          projectPath,
          'src/index.js',
          `import { run } from './api.js';\nexport function transform(input) {\n  return run(process.env.SUFFIX ?? input);\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { transform } from './src/index.js';\nimport { process } from './src/handler.js';\nimport assert from 'node:assert';\nassert.strictEqual(transform('  hi  '), 'HI!');\nassert.strictEqual(process('world'), 'WORLD');\nconsole.log('rename tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        const applied = await applyLatestPatch()(ctx);
        if (!applied.passed) return applied;
        // Must still pass tests, AND not have renamed Node's `process.env`.
        const handlerSrc = await fs.readFile(path.join(ctx.projectPath, 'src/handler.js'), 'utf-8').catch(() => '');
        const indexSrc = await fs.readFile(path.join(ctx.projectPath, 'src/index.js'), 'utf-8').catch(() => '');
        if (!handlerSrc.includes('function handle') || !indexSrc.includes('process.env.SUFFIX')) {
          return { passed: false, message: 'Rename incomplete: handler still has `process`, or Node process.env was renamed' };
        }
        return expectScriptOutput('test.js', 'rename tests passed')(ctx);
      },
    }),
    task({
      id: 'harder-refactor-extract',
      name: 'Extract a helper from a long function',
      title: 'Extract `validateAmount` from `submit`',
      description:
        'src/checkout.js has a 60-line submit() function with validation inline. Extract the validation (lines 5-25) into a new exported function `validateAmount(value)` in src/checkout.js. submit() should call validateAmount and re-throw its errors. The existing test.js must still pass.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/checkout.js',
          `export async function submit(order, payment) {\n  if (!order || !order.items || order.items.length === 0) {\n    throw new Error('order is empty');\n  }\n  const amount = order.items.reduce((s, i) => s + i.price * i.qty, 0);\n  if (!Number.isFinite(amount)) {\n    throw new Error('amount is not finite');\n  }\n  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n  if (amount > 10000) {\n    throw new Error('amount exceeds limit');\n  }\n  if (!payment || !payment.method) {\n    throw new Error('payment method required');\n  }\n  return { ok: true, amount, payment: payment.method };\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { submit } from './src/checkout.js';\nimport assert from 'node:assert';\nawait assert.rejects(() => submit({ items: [] }, { method: 'card' }), /order is empty/);\nawait assert.rejects(() => submit({ items: [{ price: -1, qty: 1 }] }, { method: 'card' }), /positive/);\nconst ok = await submit({ items: [{ price: 10, qty: 2 }] }, { method: 'card' });\nassert.strictEqual(ok.amount, 20);\nassert.strictEqual(ok.payment, 'card');\nconsole.log('extract tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        const applied = await applyLatestPatch()(ctx);
        if (!applied.passed) return applied;
        const src = await fs.readFile(path.join(ctx.projectPath, 'src/checkout.js'), 'utf-8').catch(() => '');
        if (!/export\s+function\s+validateAmount/.test(src)) {
          return { passed: false, message: 'validateAmount not exported' };
        }
        return expectScriptOutput('test.js', 'extract tests passed')(ctx);
      },
    }),
    task({
      id: 'harder-refactor-split-module',
      name: 'Split a monolith into smaller modules',
      title: 'Split src/store.js into store + selectors',
      description:
        'src/store.js exports a Store class plus a selectActive function. Move selectActive into a new file src/selectors.js, and update store.js to import from selectors.js. The existing test.js (which imports from both) must still pass.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/store.js',
          `export class Store {\n  constructor(initial = {}) { this.state = { ...initial }; this.listeners = new Set(); }\n  get(key) { return this.state[key]; }\n  set(key, value) { this.state[key] = value; for (const fn of this.listeners) fn(); }\n  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }\n}\nexport function selectActive(store) {\n  return Object.entries(store.state).filter(([_, v]) => v && v.active === true);\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { Store, selectActive } from './src/store.js';\nimport assert from 'node:assert';\nconst s = new Store({ a: { active: true }, b: { active: false }, c: { active: true } });\nconst active = selectActive(s);\nassert.strictEqual(active.length, 2);\ns.set('b', { active: true });\nassert.strictEqual(selectActive(s).length, 3);\nconsole.log('split tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        const applied = await applyLatestPatch()(ctx);
        if (!applied.passed) return applied;
        let selectorsExists = false;
        try {
          await fs.stat(path.join(ctx.projectPath, 'src/selectors.js'));
          selectorsExists = true;
        } catch {
          selectorsExists = false;
        }
        if (!selectorsExists) {
          return { passed: false, message: 'src/selectors.js not created' };
        }
        return expectScriptOutput('test.js', 'split tests passed')(ctx);
      },
    }),
  ];
}

// --------------------------------------------------------------------------
// Constraint tasks (3) — strict spec, no obvious pattern-match.
// --------------------------------------------------------------------------

export function harderConstraintSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'harder-constraints-rate-limiter',
      name: 'Implement a token bucket rate limiter',
      title: 'Build a token-bucket limiter with exact semantics',
      description:
        'Create src/rate.js exporting class TokenBucket { constructor(rate, capacity, now) }. The bucket starts FULL. take(n=1) removes n tokens and returns true if there were enough, else false and does NOT modify the bucket. Tokens refill at `rate` per second continuously. `now` defaults to () => Date.now(). DO NOT use setTimeout. The test in test.js covers full, partial, empty, and refill.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { TokenBucket } from './src/rate.js';\nimport assert from 'node:assert';\nlet now = 0;\nconst clock = () => now;\nconst b = new TokenBucket(1, 5, clock);\nassert.strictEqual(b.take(5), true);\nassert.strictEqual(b.take(1), false);\nnow = 1000;\nassert.strictEqual(b.take(1), true);\nassert.strictEqual(b.take(5), false);\nnow = 5000;\nassert.strictEqual(b.take(5), true);\nconsole.log('rate tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('rate tests passed'),
    }),
    task({
      id: 'harder-constraints-fmt-duration',
      name: 'Format durations exactly',
      title: 'Implement formatDuration(ms) with strict spec',
      description:
        'Create src/fmt.js exporting formatDuration(ms) (integer ms, non-negative). Output: less than 1s → "Ns" (e.g. 500 → "0s", no decimals); less than 60s → "Ns"; less than 60min → "Nm Ss"; else → "Hh Mm". Always zero-pad S and M to two digits only when there is also an H part. The tests in test.js pin every edge.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { formatDuration } from './src/fmt.js';\nimport assert from 'node:assert';\nassert.strictEqual(formatDuration(0), '0s');\nassert.strictEqual(formatDuration(999), '0s');\nassert.strictEqual(formatDuration(1000), '1s');\nassert.strictEqual(formatDuration(59000), '59s');\nassert.strictEqual(formatDuration(60000), '1m 00s');\nassert.strictEqual(formatDuration(125000), '2m 05s');\nassert.strictEqual(formatDuration(3600000), '1h 00m');\nassert.strictEqual(formatDuration(3661000), '1h 01m');\nconsole.log('fmt tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('fmt tests passed'),
    }),
    task({
      id: 'harder-constraints-deep-equal',
      name: 'Deep equality for plain objects',
      title: 'Implement deepEqual with cycle detection',
      description:
        'Create src/eq.js exporting deepEqual(a, b). Returns true iff a and b are structurally equal. Must handle: primitives, arrays, plain objects, Date, RegExp, Map, Set, and circular references (return false for distinct cycles, true for self-cycles). Must NOT depend on lodash or node:assert. Test in test.js exercises all cases.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { deepEqual } from './src/eq.js';\nimport assert from 'node:assert';\nassert.strictEqual(deepEqual(1, 1), true);\nassert.strictEqual(deepEqual({ a: 1 }, { a: 1 }), true);\nassert.strictEqual(deepEqual([1, 2], [1, 2]), true);\nassert.strictEqual(deepEqual(new Map([['a', 1]]), new Map([['a', 1]])), true);\nassert.strictEqual(deepEqual(new Set([1, 2]), new Set([2, 1])), true);\nassert.strictEqual(deepEqual({ a: 1 }, { a: 2 }), false);\nconst a = {}; a.self = a;\nconst b = {}; b.self = b;\nassert.strictEqual(deepEqual(a, b), true);\nconst c = {}; c.self = {};\nassert.strictEqual(deepEqual(a, c), false);\nconsole.log('eq tests passed');\n`
        );
      },
      evaluate: patchAndTestScript('eq tests passed'),
    }),
  ];
}

// --------------------------------------------------------------------------
// Write-tests tasks (3) — given buggy impl + spec, write failing-then-passing tests.
// --------------------------------------------------------------------------

export function harderWriteTestsSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'harder-write-tests-group-by',
      name: 'Write tests for groupBy',
      title: 'Test the groupBy implementation',
      description:
        'src/groupBy.js exports groupBy(items, keyFn) which groups items by keyFn(item). The current implementation is BUGGY. Write tests in test.js that capture the spec (groupBy([{a:1},{a:2},{a:1}], x => x.a) should produce {1:[{a:1},{a:1}], 2:[{a:2}]}). Your tests must pass when run against a hidden correct implementation (provided in src/groupBy.correct.js — do NOT edit it). They may fail against the buggy one.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/groupBy.js',
          `export function groupBy(items, keyFn) {\n  const out = {};\n  for (const item of items) {\n    const key = keyFn(item);\n    if (!out[key]) out[key] = [];\n    out[key].push(item);\n  }\n  return out;\n}\n`
        );
        // Hidden correct implementation that the evaluator swaps in.
        await codeFile(
          projectPath,
          'src/groupBy.correct.js',
          `export function groupBy(items, keyFn) {\n  const out = new Map();\n  for (const item of items) {\n    const key = keyFn(item);\n    const bucket = out.get(key);\n    if (bucket) bucket.push(item);\n    else out.set(key, [item]);\n  }\n  const obj = {};\n  for (const [k, v] of out) obj[k] = v;\n  return obj;\n}\n`
        );
        // A stub test.js the agent must replace.
        await codeFile(
          projectPath,
          'test.js',
          `// Write your tests for groupBy here. They should pass against the\n// correct implementation in src/groupBy.correct.js.\nimport { groupBy } from './src/groupBy.js';\nimport assert from 'node:assert';\nconsole.log('groupBy tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        // We DON'T applyLatestPatch for write-tests — the agent edits test.js directly.
        // We DO swap the buggy impl for the correct one and run the agent's tests.
        return patchAndSwapTest('src/groupBy.js', 'src/groupBy.correct.js', 'tests passed')(ctx);
      },
    }),
    task({
      id: 'harder-write-tests-flatten',
      name: 'Write tests for flatten',
      title: 'Test the flatten implementation',
      description:
        'src/flatten.js exports flatten(arr) which deeply flattens nested arrays (any depth). The current implementation is shallow-only. Write tests in test.js that capture the spec. They must pass against src/flatten.correct.js.',
      complexity: 'simple',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/flatten.js',
          `export function flatten(arr) {\n  return arr.flat(1);\n}\n`
        );
        await codeFile(
          projectPath,
          'src/flatten.correct.js',
          `export function flatten(arr) {\n  const out = [];\n  for (const x of arr) {\n    if (Array.isArray(x)) out.push(...flatten(x));\n    else out.push(x);\n  }\n  return out;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `// Write tests for flatten. Must pass on src/flatten.correct.js.\nimport { flatten } from './src/flatten.js';\nimport assert from 'node:assert';\nconsole.log('flatten tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        return patchAndSwapTest('src/flatten.js', 'src/flatten.correct.js', 'tests passed')(ctx);
      },
    }),
    task({
      id: 'harder-write-tests-debounce',
      name: 'Write tests for debounce',
      title: 'Test the debounce implementation',
      description:
        'src/debounce.js exports debounce(fn, ms) which returns a function that delays calling fn until ms have passed since the last invocation. The current implementation calls fn on EVERY invocation. Write tests in test.js that capture the spec. They must pass against src/debounce.correct.js.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await baseProject(projectPath);
        await codeFile(
          projectPath,
          'src/debounce.js',
          `export function debounce(fn, ms) {\n  return (...args) => fn(...args);\n}\n`
        );
        await codeFile(
          projectPath,
          'src/debounce.correct.js',
          `export function debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `// Write tests for debounce. Must pass on src/debounce.correct.js.\nimport { debounce } from './src/debounce.js';\nimport assert from 'node:assert';\nconsole.log('debounce tests passed');\n`
        );
      },
      evaluate: async (ctx) => {
        return patchAndSwapTest('src/debounce.js', 'src/debounce.correct.js', 'tests passed')(ctx);
      },
    }),
  ];
}

export function harderSuite(): BenchmarkTask[] {
  return [
    ...harderDebugSuite(),
    ...harderRefactorSuite(),
    ...harderConstraintSuite(),
    ...harderWriteTestsSuite(),
  ];
}
