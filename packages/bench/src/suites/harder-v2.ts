/**
 * Harder v2: 10 multi-file, architectural, edge-case tasks.
 * Self-contained, no repo cloning, run in seconds.
 */

import type { EvaluationContext, BenchmarkEvaluation } from '../types.js';
import { task, codeFile } from './builder.js';
import { applyLatestPatch } from './eval-helpers.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function runNode(cwd: string, file: string): Promise<{ ok: boolean; output: string }> {
  return execFileAsync('node', [file], { cwd, timeout: 10000 })
    .then(({ stdout, stderr }) => ({ ok: true, output: stdout + '\n' + stderr }))
    .catch((e: unknown) => {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
    });
}

function harderV2Task(
  id: string,
  title: string,
  description: string,
  files: [string, string][],
  testFn: (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> | BenchmarkEvaluation
) {
  return task({
    id,
    name: id,
    title,
    description,
    complexity: 'medium',
    setup: async (projectPath: string) => {
      for (const [file, content] of files) {
        await codeFile(projectPath, file, content);
      }
    },
    evaluate: async (ctx: EvaluationContext) => {
      const patchResult = await applyLatestPatch()(ctx);
      if (!patchResult.passed) return patchResult;
      return testFn(ctx);
    },
  });
}

function eventEmitterLeak() {
  return harderV2Task(
    'harder-v2-event-emitter-leak',
    'Fix event emitter memory leak from wrong listener reference',
    'Fix the memory leak in EventEmitter. The issue: off() is called with a NEW function reference instead of the original listener, so the listener is never removed. Fix src/emitter.js so listeners are properly removed. Do NOT change test.js.',
    [
      ['src/emitter.js', `export class EventEmitter {
  constructor() { this._events = new Map(); }
  on(event, fn) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(fn);
    return this;
  }
  off(event, fn) {
    const listeners = this._events.get(event) || [];
    this._events.set(event, listeners.filter(l => l !== (() => fn())));
    return this;
  }
  emit(event, ...args) {
    const listeners = this._events.get(event) || [];
    for (const fn of listeners) fn(...args);
    return listeners.length;
  }
  listenerCount(event) {
    return (this._events.get(event) || []).length;
  }
}
`],
      ['test.js', `import { EventEmitter } from './src/emitter.js';
const emitter = new EventEmitter();
const handler = () => console.log('called');
emitter.on('data', handler);
emitter.emit('data');
emitter.off('data', handler);
const count = emitter.listenerCount('data');
console.log('listeners after off:', count);
if (count !== 0) { console.error('FAIL: expected 0 listeners'); process.exit(1); }
console.log('PASS');
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Event emitter leak fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function promiseAllRace() {
  return harderV2Task(
    'harder-v2-promise-all-race',
    'Fix Promise.allSettled error propagation',
    'The parallelFetch() function swallows errors from failed promises. Fix src/parallel.js so that when ALL promises fail, the error is properly thrown. When SOME succeed, return the successful results. Do NOT change test.js.',
    [
      ['src/parallel.js', `export async function parallelFetch(urls) {
  const results = await Promise.allSettled(
    urls.map(url => fetch(url).then(r => r.json()))
  );
  return results.map(r => r.value);
}
`],
      ['test.js', `import { parallelFetch } from './src/parallel.js';
globalThis.fetch = async (url) => ({
  json: async () => ({ url, ok: true })
});
async function test() {
  const r1 = await parallelFetch(['http://a.com', 'http://b.com']);
  if (r1.length !== 2) throw new Error('Expected 2 results');
  globalThis.fetch = async () => { throw new Error('network error'); };
  try {
    await parallelFetch(['http://a.com']);
    throw new Error('Should have thrown');
  } catch (e) {
    if (e.message === 'Should have thrown') throw e;
  }
  let callCount = 0;
  globalThis.fetch = async (url) => {
    callCount++;
    if (callCount === 1) throw new Error('fail');
    return { json: async () => ({ url, ok: true }) };
  };
  const r3 = await parallelFetch(['http://a.com', 'http://b.com']);
  if (r3.length !== 1) throw new Error('Expected 1 successful result');
  console.log('PASS');
}
test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Promise error propagation fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function lruCacheEviction() {
  return harderV2Task(
    'harder-v2-lru-cache-eviction',
    'Fix LRU cache max size eviction',
    'The LRU cache in src/lru.js does not evict the oldest entry when max size is reached. Fix it so that get() and set() both update access order, and the oldest entry is evicted when capacity is exceeded. Do NOT change test.js.',
    [
      ['src/lru.js', `export class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return -1;
    return this.cache.get(key);
  }
  set(key, value) {
    this.cache.set(key, value);
  }
  size() { return this.cache.size; }
}
`],
      ['test.js', `import { LRUCache } from './src/lru.js';
const cache = new LRUCache(3);
cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
cache.get('a');
cache.set('d', 4);
if (cache.get('b') !== -1) throw new Error('Expected b to be evicted');
if (cache.get('a') === -1) throw new Error('Expected a to still exist');
if (cache.size() > 3) throw new Error('Cache exceeded max size');
console.log('PASS');
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'LRU eviction fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function debounceCancel() {
  return harderV2Task(
    'harder-v2-debounce-cancel',
    'Fix debounce cancel not clearing pending timeout',
    'The debounce function in src/debounce.js has a cancel() method that does not actually clear the pending timeout. Fix it so cancel() prevents the pending execution from firing. Do NOT change test.js.',
    [
      ['src/debounce.js', `export function debounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    timer = null;
  };
  return debounced;
}
`],
      ['test.js', `import { debounce } from './src/debounce.js';
let called = false;
const fn = () => { called = true; };
const d = debounce(fn, 50);
d();
d.cancel();
setTimeout(() => {
  if (called) { console.error('FAIL: function was called after cancel'); process.exit(1); }
  console.log('PASS');
}, 100);
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Debounce cancel fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function deepCloneCircular() {
  return harderV2Task(
    'harder-v2-deep-clone-circular',
    'Fix deep clone to handle circular references',
    'The deepClone function in src/clone.js crashes on circular references. Fix it to detect and handle circular references by using a WeakSet to track visited objects. Do NOT change test.js.',
    [
      ['src/clone.js', `export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => deepClone(item));
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}
`],
      ['test.js', `import { deepClone } from './src/clone.js';
const a = { x: 1, y: [2, 3] };
const b = deepClone(a);
if (b.x !== 1 || JSON.stringify(b.y) !== '[2,3]') throw new Error('Normal clone failed');
const c = { name: 'parent' };
c.self = c;
try {
  const d = deepClone(c);
  if (d.self !== d) throw new Error('Circular ref should point to clone');
} catch (e) {
  if (e.message.includes('Maximum call stack') || e.message.includes('recursion')) {
    throw new Error('Circular reference caused infinite loop');
  }
  throw e;
}
console.log('PASS');
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Deep clone circular ref fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function rateLimiter() {
  return harderV2Task(
    'harder-v2-rate-limiter',
    'Fix rate limiter to properly limit concurrent requests',
    'The rate limiter in src/ratelimit.js allows unlimited concurrent executions. Fix it so at most N functions run at the same time. Queued functions should wait for a slot. Do NOT change test.js.',
    [
      ['src/ratelimit.js', `export class RateLimiter {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
  }
  async run(fn) {
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
    }
  }
}
`],
      ['test.js', `import { RateLimiter } from './src/ratelimit.js';
const limiter = new RateLimiter(2);
let maxConcurrent = 0;
let current = 0;
async function taskFn(id, delay) {
  current++;
  maxConcurrent = Math.max(maxConcurrent, current);
  await new Promise(r => setTimeout(r, delay));
  current--;
}
async function test() {
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(limiter.run(() => taskFn(i, 50)));
  }
  await Promise.all(promises);
  if (maxConcurrent > 2) throw new Error('Max concurrent was ' + maxConcurrent + ', expected <= 2');
  console.log('PASS');
}
test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Rate limiter fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function configMerger() {
  return harderV2Task(
    'harder-v2-config-merger',
    'Fix config merger to deep merge arrays',
    'The config merger in src/config.js replaces arrays instead of merging them. Fix merge() to concatenate arrays from both sources instead of overwriting. Do NOT change test.js.',
    [
      ['src/config.js', `export function merge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    result[key] = overrides[key];
  }
  return result;
}
`],
      ['test.js', `import { merge } from './src/config.js';
const defaults = { a: 1, b: [1, 2, 3], c: { x: 1 } };
const overrides = { b: [4, 5], c: { y: 2 } };
const result = merge(defaults, overrides);
if (JSON.stringify(result.b) !== '[1,2,3,4,5]') throw new Error('Arrays not merged: ' + JSON.stringify(result.b));
if (result.c.x !== 1 || result.c.y !== 2) throw new Error('Objects not merged');
console.log('PASS');
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Config merger fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function asyncQueue() {
  return harderV2Task(
    'harder-v2-async-queue',
    'Fix async queue to wait instead of dropping tasks',
    'The async queue in src/queue.js drops tasks when the queue is full. Fix it so tasks wait for a slot to open instead of being rejected. Do NOT change test.js.',
    [
      ['src/queue.js', `export class AsyncQueue {
  constructor(concurrency, maxSize) {
    this.concurrency = concurrency;
    this.maxSize = maxSize;
    this.running = 0;
    this.queue = [];
  }
  async push(fn) {
    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxSize) {
        throw new Error('Queue full');
      }
      this.queue.push(fn);
      return;
    }
    this.running++;
    try { await fn(); } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        this.push(next);
      }
    }
  }
}
`],
      ['test.js', `import { AsyncQueue } from './src/queue.js';
const queue = new AsyncQueue(1, 2);
let completed = [];
async function test() {
  const tasks = [];
  for (let i = 0; i < 4; i++) {
    const idx = i;
    tasks.push(queue.push(() => new Promise(r => setTimeout(() => { completed.push(idx); r(); }, 10))));
  }
  await Promise.all(tasks);
  if (completed.length !== 4) throw new Error('Expected 4 completed, got ' + completed.length);
  console.log('PASS');
}
test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Async queue fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function retryBackoff() {
  return harderV2Task(
    'harder-v2-retry-backoff',
    'Fix retry to use exponential backoff',
    'The retry function in src/retry.js uses a fixed delay for all retries. Fix it to use exponential backoff: delay doubles each attempt (base * 2^attempt). Do NOT change test.js.',
    [
      ['src/retry.js', `export async function retry(fn, { maxAttempts = 3, baseDelay = 100 } = {}) {
  let lastError;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, baseDelay));
    }
  }
  throw lastError;
}
`],
      ['test.js', `import { retry } from './src/retry.js';
async function test() {
  let attempts = [];
  await retry(async () => {
    attempts.push(Date.now());
    if (attempts.length < 4) throw new Error('not yet');
  }, { maxAttempts: 4, baseDelay: 10 });
  if (attempts.length !== 4) throw new Error('Expected 4 attempts');
  const d1 = attempts[1] - attempts[0];
  const d2 = attempts[2] - attempts[1];
  const d3 = attempts[3] - attempts[2];
  if (d2 < d1 * 1.5) throw new Error('Not exponential: d1=' + d1 + ' d2=' + d2);
  if (d3 < d2 * 1.5) throw new Error('Not exponential: d2=' + d2 + ' d3=' + d3);
  console.log('PASS');
}
test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'Retry backoff fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

function stateMachine() {
  return harderV2Task(
    'harder-v2-state-machine',
    'Fix state machine to reject invalid transitions',
    'The state machine in src/state.js accepts any transition without validation. Fix it to check a transition table and throw on invalid transitions. Do NOT change test.js.',
    [
      ['src/state.js', `export class StateMachine {
  constructor(initial, transitions) {
    this.state = initial;
    this.transitions = transitions;
  }
  transition(to) {
    this.state = to;
    return this.state;
  }
}
`],
      ['test.js', `import { StateMachine } from './src/state.js';
const sm = new StateMachine('idle', {
  idle: ['loading'],
  loading: ['loaded', 'error'],
  loaded: ['idle'],
  error: ['idle'],
});
sm.transition('loading');
sm.transition('loaded');
sm.transition('idle');
try {
  sm.transition('loaded');
  throw new Error('Should have thrown on invalid transition');
} catch (e) {
  if (e.message.includes('Should have thrown')) throw e;
}
if (sm.state !== 'idle') throw new Error('State should still be idle');
console.log('PASS');
`],
    ],
    async (ctx) => {
      const r = await runNode(ctx.projectPath, 'test.js');
      return { passed: r.ok && r.output.includes('PASS'), message: r.ok ? 'State machine validation fixed' : 'Failed: ' + r.output.slice(-200) };
    }
  );
}

export function harderV2Suite() {
  return [
    eventEmitterLeak(),
    promiseAllRace(),
    lruCacheEviction(),
    debounceCancel(),
    deepCloneCircular(),
    rateLimiter(),
    configMerger(),
    asyncQueue(),
    retryBackoff(),
    stateMachine(),
  ];
}
