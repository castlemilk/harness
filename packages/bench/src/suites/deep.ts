import type { BenchmarkTask } from '../types.js';
import { task, nodeProject, codeFile, combined } from './builder.js';
import { applyLatestPatch, expectScriptOutput } from './eval-helpers.js';

function evalTest(text: string): ReturnType<typeof combined> {
  return combined(applyLatestPatch(), expectScriptOutput('test.js', text));
}

/**
 * Deeper evaluation suite: 10 small but non-trivial tasks that exercise
 * debugging, refactoring, API design, async behaviour, and multi-file work.
 * Each project is deterministic and validates in seconds.
 */
export function deepSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'deep-debug-off-by-one',
      name: 'Fix an off-by-one binary search',
      title: 'Debug binarySearch off-by-one',
      description:
        'The existing src/search.js has an off-by-one bug in binarySearch so some lookups fail. Fix it so the tests pass. Do not rewrite the file; make the smallest fix.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/search.js',
          `export function binarySearch(arr, target) {\n  let lo = 0;\n  let hi = arr.length;\n  while (lo < hi) {\n    const mid = Math.floor((lo + hi) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) lo = mid;\n    else hi = mid;\n  }\n  return -1;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { binarySearch } from './src/search.js';\nimport assert from 'node:assert';\nassert.strictEqual(binarySearch([1,2,3,4,5], 3), 2);\nassert.strictEqual(binarySearch([1,2,3,4,5], 5), 4);\nassert.strictEqual(binarySearch([1,2,3,4,5], 1), 0);\nassert.strictEqual(binarySearch([1,2,3,4,5], 6), -1);\nassert.strictEqual(binarySearch([], 1), -1);\nconsole.log('binarySearch tests passed');\n`
        );
      },
      evaluate: evalTest('binarySearch tests passed'),
    }),
    task({
      id: 'deep-refactor-memoize-ttl',
      name: 'Add TTL to a memoize cache',
      title: 'Refactor memoize with TTL eviction',
      description:
        'Refactor src/cache.js so memoize(fn, ttlMs) evicts cached entries after ttlMs. Keep memoize(fn) working without TTL (never expires). The test uses fake timers via a passed-in now() function.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/cache.js',
          `export function memoize(fn, ttlMs, now = () => Date.now()) {\n  const cache = new Map();\n  return (arg) => {\n    if (cache.has(arg)) return cache.get(arg).value;\n    const value = fn(arg);\n    cache.set(arg, { value, at: now() });\n    return value;\n  };\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { memoize } from './src/cache.js';\nimport assert from 'node:assert';\nlet calls = 0;\nlet t = 0;\nconst now = () => t;\nconst double = memoize((n) => { calls++; return n * 2; }, 100, now);\nassert.strictEqual(double(2), 4);\nassert.strictEqual(double(2), 4);\nassert.strictEqual(calls, 1);\nt = 150;\nassert.strictEqual(double(2), 4);\nassert.strictEqual(calls, 2);\nconst noTtl = memoize((n) => n + 1);\nassert.strictEqual(noTtl(1), 2);\nassert.strictEqual(noTtl(1), 2);\nconsole.log('memoize ttl tests passed');\n`
        );
      },
      evaluate: evalTest('memoize ttl tests passed'),
    }),
    task({
      id: 'deep-api-validation',
      name: 'Design a validation API',
      title: 'Implement validateUser with exact error messages',
      description:
        'Create src/validate.js exporting validateUser(input) that returns { valid: true } or { valid: false, errors: string[] }. Rules: name required non-empty string, age integer 0-150, email must contain "@". Error messages: "name is required", "age must be an integer between 0 and 150", "email is invalid". Collect all errors, do not fail fast.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { validateUser } from './src/validate.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(validateUser({ name: 'a', age: 30, email: 'a@b.co' }), { valid: true });\nassert.deepStrictEqual(validateUser({ name: '', age: 200, email: 'nope' }), { valid: false, errors: ['name is required', 'age must be an integer between 0 and 150', 'email is invalid'] });\nassert.deepStrictEqual(validateUser({ name: 'a', age: -1, email: 'x' }), { valid: false, errors: ['age must be an integer between 0 and 150', 'email is invalid'] });\nconsole.log('validateUser tests passed');\n`
        );
      },
      evaluate: evalTest('validateUser tests passed'),
    }),
    task({
      id: 'deep-async-retry-backoff',
      name: 'Implement async retry with backoff',
      title: 'Add retry with exponential backoff',
      description:
        'Create src/retry.js exporting an async retry(fn, { attempts, baseMs, factor, jitter }) that retries fn until it succeeds or attempts are exhausted, waiting baseMs * factor^(n-1) plus a deterministic jitter derived from the attempt number (no Math.random). The test uses a sleep stub to avoid real waiting.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { retry } from './src/retry.js';\nimport assert from 'node:assert';\nconst sleeps = [];\nconst sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };\nlet tries = 0;\nconst flaky = async () => { tries++; if (tries < 3) throw new Error('fail'); return 'ok'; };\nconst result = await retry(flaky, { attempts: 4, baseMs: 10, factor: 2, jitter: (n) => n, sleep });\nassert.strictEqual(result, 'ok');\nassert.strictEqual(tries, 3);\nassert.deepStrictEqual(sleeps, [11, 22]);\nawait assert.rejects(() => retry(async () => { throw new Error('always'); }, { attempts: 2, baseMs: 1, factor: 1, jitter: () => 0, sleep }), /always/);\nconsole.log('retry backoff tests passed');\n`
        );
      },
      evaluate: evalTest('retry backoff tests passed'),
    }),
    task({
      id: 'deep-error-accumulation',
      name: 'Accumulate validation errors',
      title: 'Implement validateAll that collects all errors',
      description:
        'Create src/validate.js exporting validateAll(schema, input) where schema is { field: (v) => true | string }. Return { valid: true, value: input } or { valid: false, errors: { field: message } }. Do not stop at the first error.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { validateAll } from './src/validate.js';\nimport assert from 'node:assert';\nconst schema = {\n  name: (v) => (typeof v === 'string' && v.length > 0 ? true : 'name required'),\n  age: (v) => (Number.isInteger(v) && v >= 0 ? true : 'age invalid'),\n};\nassert.deepStrictEqual(validateAll(schema, { name: 'a', age: 3 }), { valid: true, value: { name: 'a', age: 3 } });\nassert.deepStrictEqual(validateAll(schema, { name: '', age: -1 }), { valid: false, errors: { name: 'name required', age: 'age invalid' } });\nconsole.log('validateAll tests passed');\n`
        );
      },
      evaluate: evalTest('validateAll tests passed'),
    }),
    task({
      id: 'deep-lru-cache',
      name: 'Implement an LRU cache',
      title: 'Add LRUCache with max-size eviction',
      description:
        'Create src/lru.js exporting class LRUCache { constructor(maxSize); get(key); set(key, value); }. Evict the least-recently-used entry when exceeding maxSize. Getting an entry marks it as most-recently-used.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { LRUCache } from './src/lru.js';\nimport assert from 'node:assert';\nconst c = new LRUCache(2);\nc.set('a', 1);\nc.set('b', 2);\nassert.strictEqual(c.get('a'), 1);\nc.set('c', 3);\nassert.strictEqual(c.get('b'), undefined);\nassert.strictEqual(c.get('a'), 1);\nassert.strictEqual(c.get('c'), 3);\nconsole.log('lru tests passed');\n`
        );
      },
      evaluate: evalTest('lru tests passed'),
    }),
    task({
      id: 'deep-csv-quotes',
      name: 'Parse CSV with quoted fields',
      title: 'Extend CSV parser to handle quotes',
      description:
        'Create src/csv.js exporting parseCsvLine(line) that splits on commas but respects double-quoted fields (which may contain commas). Quotes inside quoted fields are escaped as "".',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { parseCsvLine } from './src/csv.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(parseCsvLine('a,b,c'), ['a','b','c']);\nassert.deepStrictEqual(parseCsvLine('"a,b",c'), ['a,b','c']);\nassert.deepStrictEqual(parseCsvLine('"she said ""hi""",x'), ['she said "hi"','x']);\nassert.deepStrictEqual(parseCsvLine('  a , " b " ,c'), ['a','b','c']);\nconsole.log('csv quotes tests passed');\n`
        );
      },
      evaluate: evalTest('csv quotes tests passed'),
    }),
    task({
      id: 'deep-cli-flags',
      name: 'Parse CLI arguments',
      title: 'Implement parseArgs for a CLI',
      description:
        'Create src/args.js exporting parseArgs(argv) that supports --flag (boolean), --key=value, --key value, and positional args. Return { flags: {flag: true}, options: {key: value}, positional: [] }.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { parseArgs } from './src/args.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(parseArgs(['--verbose', '--out=dist', '--mode', 'fast', 'file1', 'file2']), { flags: { verbose: true }, options: { out: 'dist', mode: 'fast' }, positional: ['file1', 'file2'] });\nassert.deepStrictEqual(parseArgs([]), { flags: {}, options: {}, positional: [] });\nconsole.log('parseArgs tests passed');\n`
        );
      },
      evaluate: evalTest('parseArgs tests passed'),
    }),
    task({
      id: 'deep-transform-pipeline',
      name: 'Build a transform pipeline',
      title: 'Implement pipe/compose for data transforms',
      description:
        'Create src/pipe.js exporting pipe(...fns) that returns a function applying fns left-to-right, and compose(...fns) right-to-left. The test pipelines string transforms.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { pipe, compose } from './src/pipe.js';\nimport assert from 'node:assert';\nconst trim = (s) => s.trim();\nconst upper = (s) => s.toUpperCase();\nconst exclaim = (s) => s + '!';\nassert.strictEqual(pipe(trim, upper, exclaim)('  hi '), 'HI!');\nassert.strictEqual(compose(exclaim, upper, trim)('  hi '), 'HI!');\nconsole.log('pipe tests passed');\n`
        );
      },
      evaluate: evalTest('pipe tests passed'),
    }),
    task({
      id: 'deep-multi-file-feature',
      name: 'Implement a small feature across two files',
      title: 'Add a store and API across src/store.js and src/api.js',
      description:
        'Create src/store.js exporting createStore(initial) with get/set/subscribe, and src/api.js exporting selectTotal(store) that sums numeric values in the store state. The test wires them together.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { createStore } from './src/store.js';\nimport { selectTotal } from './src/api.js';\nimport assert from 'node:assert';\nconst store = createStore({ a: 1, b: 2 });\nassert.strictEqual(selectTotal(store), 3);\nlet notified = 0;\nstore.subscribe(() => { notified++; });\nstore.set('c', 3);\nassert.strictEqual(selectTotal(store), 6);\nassert.strictEqual(notified, 1);\nconsole.log('store/api tests passed');\n`
        );
      },
      evaluate: evalTest('store/api tests passed'),
    }),
  ];
}
