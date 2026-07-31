/**
 * Hard-targeting suite: 10 tasks designed to fail on current agents without
 * investigate/research/escalation behaviors.
 *
 * Each task targets a specific harness weakness:
 *
 *   1. debug-event-listener-leak   — agent must grep for addEventListener, not just fix the obvious line
 *   2. refactor-public-api         — agent must grep callers, not just rename the function
 *   3. fix-async-race              — agent must read the timing, not guess
 *   4. fix-on2-regression          — agent must measure, not just rewrite the loop
 *   5. add-feature-without-breaking — agent must update tests + callers
 *   6. spec-ambiguous-correctness  — tests pass but behavior is wrong (off-by-scope)
 *   7. debug-config-drift          — config file parsed differently in two places
 *   8. migrate-deprecated-api      — agent must update all callers, not just one file
 *   9. fix-subtle-type-coercion    — string→number coercion bug in comparison
 *  10. adversarial-test-fix         — naive fix passes tests but doesn't fix the bug
 *
 * The eval helpers intentionally include hidden tests (run via a separate
 * "spec.js" file the agent doesn't see) to catch the adversarial case.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EvaluationContext, BenchmarkEvaluation } from '../types.js';
import { task, codeFile, nodeProject } from './builder.js';
import { applyLatestPatch } from './eval-helpers.js';

const execFileAsync = promisify(execFile);

/**
 * Run a project's hidden spec tests. These are NOT shown to the agent in
 * the task description — they're a separate file. This catches the
 * "fix passes agent-visible tests but violates spec" case.
 */
async function runHiddenSpec(ctx: EvaluationContext): Promise<{ passed: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', ['test.js'], {
      cwd: ctx.projectPath,
      timeout: 10_000,
    });
    return { passed: true, output: `${stdout}\n${stderr}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { passed: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

/**
 * Task 1: Event listener leak across request lifecycle.
 *
 * A web server adds a listener in one path but only removes it in another.
 * Tests for the leak are in a hidden spec.js file (not in test.js).
 * A naive agent will fix the obvious `addEventListener` call but miss the
 * `removeEventListener` symmetry required by the spec.
 */
function debugEventListenerLeak(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Hidden spec tests failed', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Event listener leak fixed correctly' };
  };
}

/**
 * Task 2: Public API rename breaks consumers.
 *
 * The test.js file imports the renamed function under its new name, so the
 * agent passes the visible tests by updating only src/. But there's a hidden
 * consumer in another file that still uses the old import. The spec requires
 * updating ALL callers.
 */
function refactorPublicApi(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    // The hidden spec checks that no consumer is broken.
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Hidden spec detected broken consumer', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'All consumers updated' };
  };
}

/**
 * Task 3: Async race condition.
 *
 * Two concurrent operations on shared state can interleave. The fix requires
 * using a queue or lock. A naive agent will add setTimeout or retry logic.
 * Hidden spec tests with concurrent invocations catch the race.
 */
function fixAsyncRace(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Race condition still present under concurrency', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Race condition fixed' };
  };
}

/**
 * Task 4: Performance regression from O(n²) to O(n).
 *
 * The agent must understand the algorithm, not just preserve behavior.
 * The visible tests just check correctness, but the hidden spec has a
 * timeout test that fails if the operation is too slow.
 */
function fixOn2Regression(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Performance regression not fixed', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Performance restored' };
  };
}

/**
 * Task 5: Add a new feature without breaking the public API.
 *
 * The agent must ADD a new parameter to a public function with a default
 * value, not break existing callers, AND update the spec'd behavior.
 * Hidden spec tests BOTH backward compat AND new behavior.
 */
function addFeatureWithoutBreaking(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'New feature or backwards compat broken', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Feature added without breaking compat' };
  };
}

/**
 * Task 6: Spec ambiguity — tests pass but behavior is wrong.
 *
 * The visible tests check a narrow contract. The spec (hidden) requires a
 * broader behavior. The agent must read the spec file (which is in a
 * `SPEC.md` they can find) and understand intent.
 */
function specAmbiguousCorrectness(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Visible tests pass but spec violated', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Spec intent met' };
  };
}

/**
 * Task 7: Config drift between two parsers.
 *
 * The same config file is parsed in two places with slightly different
 * behavior. The bug is the inconsistency, not in either parser alone.
 * The agent must read both and reconcile.
 */
function debugConfigDrift(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Config drift not reconciled', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Config drift fixed' };
  };
}

/**
 * Task 8: Migration across many files.
 *
 * A deprecated API is used in 5+ files. The agent must find all usages and
 * update them. Hidden spec tests with the new API behavior.
 */
function migrateDeprecatedApi(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Migration incomplete', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Migration complete' };
  };
}

/**
 * Task 9: Subtle type coercion.
 *
 * `==` vs `===`, or implicit string→number coercion in a comparison.
 * Visible tests pass because they don't test the edge case.
 * Hidden spec tests the edge case.
 */
function fixSubtleTypeCoercion(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Type coercion bug present', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Type coercion fixed' };
  };
}

/**
 * Task 10: Adversarial test-fix.
 *
 * The agent's task description includes the bug, AND the test.js has a
 * near-miss test that almost passes with a wrong fix. The hidden spec
 * catches the wrong fix by testing a different but related case.
 */
function adversarialTestFix(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const applied = await applyLatestPatch()(ctx);
    if (!applied.passed) return applied;
    const result = await runHiddenSpec(ctx);
    if (!result.passed) {
      return { passed: false, message: 'Adversarial: fix passes visible tests but not spec', metrics: { output: result.output.slice(-300) } };
    }
    return { passed: true, message: 'Adversarial fix correct' };
  };
}

// --------------------------------------------------------------------------
// Suite definitions
// --------------------------------------------------------------------------

import type { BenchmarkTask } from '../types.js';

export function hardTargetedSuite(): BenchmarkTask[] {
  return [
    // 1. Event listener leak (debug)
    task({
      id: 'hard-debug-event-listener-leak',
      name: 'Fix event listener leak across request lifecycle',
      title: 'Find and fix an event listener leak',
      description:
        'A web server leaks event listeners across request lifecycle. Memory usage grows unboundedly. ' +
        'Find the leak and fix it without breaking the happy path. ' +
        'Look at all places where listeners are added and ensure each is removed in the right scope. ' +
        'Use search to find all addEventListener calls before fixing.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        // The visible code with the leak.
        await codeFile(
          projectPath,
          'src/server.js',
          `import { EventEmitter } from 'node:events';\n\nconst bus = new EventEmitter();\n\nlet nextRequestId = 0;\nconst listeners = new Map();\n\nexport function handleRequest(req) {\n  const id = ++nextRequestId;\n  bus.addListener('tick', () => logProgress(id));\n  // Simulate work\n  setTimeout(() => {\n    bus.emit('done', { id, req });\n  }, 10);\n}\n\nfunction logProgress(id) {\n  // Side-effect for demo\n}\n\n// Hidden spec test: must not leak.\nexport function leakCount() {\n  return bus.listenerCount('tick');\n}\n`
        );
        // Visible test: just checks happy path.
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { handleRequest } from './src/server.js';\nimport { leakCount } from './src/server.js';\n\n// This test is happy-path only. It doesn't actually catch the leak.\nfor (let i = 0; i < 100; i++) handleRequest({ id: i });\nawait new Promise((r) => setTimeout(r, 100));\nassert.ok(true);\nconsole.log('test ok');\n`
        );
      },
      evaluate: debugEventListenerLeak(),
    }),

    // 2. Public API rename breaks consumer
    task({
      id: 'hard-refactor-public-api',
      name: 'Rename a public API without breaking its consumer',
      title: 'Rename a public function across the codebase',
      description:
        'Rename the exported function `formatCurrency` to `formatMoney` in src/money.js. ' +
        'Update all callers across the project. Use search to find all usages before changing. ' +
        'There may be consumers in files you have to discover.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/money.js',
          `export function formatCurrency(amount, currency) {\n  return amount.toFixed(2) + ' ' + currency;\n}\n`
        );
        await codeFile(
          projectPath,
          'src/api.js',
          `import { formatCurrency } from './money.js';\nexport function price(amt) { return formatCurrency(amt, 'USD'); }\n`
        );
        await codeFile(
          projectPath,
          'src/consumer.js',
          `import { formatCurrency } from './money.js';\nexport function display(amt) { return formatCurrency(amt, 'EUR'); }\n`
        );
        // Hidden consumer — agent must find it via search.
        await codeFile(
          projectPath,
          'src/billing.js',
          `import { formatCurrency } from './money.js';\nexport function bill(amt) { return formatCurrency(amt, 'GBP'); }\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { price } from './src/api.js';\nimport { display } from './src/consumer.js';\n\n// Visible test only imports from api.js and consumer.js — not billing.js.\nassert.strictEqual(price(10), '10.00 USD');\nassert.strictEqual(display(20), '20.00 EUR');\nconsole.log('test ok');\n`
        );
      },
      evaluate: refactorPublicApi(),
    }),

    // 3. Async race
    task({
      id: 'hard-fix-async-race',
      name: 'Fix an async race condition in a counter',
      title: 'Fix concurrent counter race condition',
      description:
        'A counter is incremented concurrently. The naive code has a race that loses increments. ' +
        'Fix it so all concurrent calls are counted. Use read_file on src/ to understand the current implementation. ' +
        'You may need to use an async queue or atomic operations.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/counter.js',
          `let value = 0;\nconst queue = [];\nlet running = false;\n\nexport async function increment() {\n  // Naive: read-modify-write races.\n  const cur = value;\n  await new Promise((r) => setTimeout(r, 1));\n  value = cur + 1;\n}\n\nexport async function get() { return value; }\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { increment, get } from './src/counter.js';\n\n// Visible test is sequential — passes regardless of race fix.\nawait increment();\nawait increment();\nassert.strictEqual(await get(), 2);\nconsole.log('test ok');\n`
        );
      },
      evaluate: fixAsyncRace(),
    }),

    // 4. O(n²) regression
    task({
      id: 'hard-fix-on2-regression',
      name: 'Fix an accidental O(n²) regression',
      title: 'Restore linear performance in a hot loop',
      description:
        'A function that should be O(n) is now O(n²) due to a recent change. The visible test ' +
        'checks correctness only. The spec requires the function to handle 10,000 inputs in under 100ms. ' +
        'Read src/ to find the bug.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/search.js',
          `export function uniqueSorted(arr) {\n  const seen = [];\n  for (const x of arr) {\n    // BUG: O(n²) — should use a Set for membership check.\n    if (!seen.includes(x)) {\n      seen.push(x);\n      seen.sort((a, b) => a - b);\n    }\n  }\n  return seen;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { uniqueSorted } from './src/search.js';\n\n// Visible test: small input, fast either way.\nassert.deepStrictEqual(uniqueSorted([3, 1, 2, 1, 3]), [1, 2, 3]);\nconsole.log('test ok');\n`
        );
      },
      evaluate: fixOn2Regression(),
    }),

    // 5. Add a feature without breaking
    task({
      id: 'hard-add-feature-without-breaking',
      name: 'Add a new optional parameter to a public function',
      title: 'Add an options parameter to format() without breaking callers',
      description:
        'Add an optional second argument `options` to the exported function `format()` in src/text.js. ' +
        'If options.rounding is provided, round to that many decimal places. ' +
        'Existing callers (which pass only one argument) must keep working unchanged. ' +
        'Update any callers that need the new feature. Use search to find all callers.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/text.js',
          `export function format(num) {\n  return '$' + num.toFixed(2);\n}\n`
        );
        await codeFile(
          projectPath,
          'src/buyer.js',
          `import { format } from './text.js';\nexport function price(p) { return format(p); }\n`
        );
        await codeFile(
          projectPath,
          'src/invoice.js',
          `import { format } from './text.js';\nexport function line(qty, p) { return format(qty * p); }\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { price } from './src/buyer.js';\nimport { line } from './src/invoice.js';\n\n// Visible tests only check the original one-arg call signature.\nassert.strictEqual(price(10), '$10.00');\nassert.strictEqual(line(3, 2.5), '$7.50');\nconsole.log('test ok');\n`
        );
      },
      evaluate: addFeatureWithoutBreaking(),
    }),

    // 6. Spec ambiguity
    task({
      id: 'hard-spec-ambiguous-correctness',
      name: 'Fix visible tests but meet the actual spec',
      title: 'Read SPEC.md and implement the right behavior',
      description:
        'The visible tests pass with a narrow implementation, but the SPEC.md file describes the ' +
        'full intended behavior. Read SPEC.md to understand what the function should really do. ' +
        'The hidden spec tests the full behavior.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'SPEC.md',
          `# slug()\n\nGenerate a URL-safe slug from a string. Spec:\n\n- Lowercase all characters\n- Replace any character that is NOT [a-z0-9] with a single dash\n- Trim leading/trailing dashes\n- Collapse consecutive dashes into one\n- Maximum length 80 characters\n- If the resulting string is empty, return "untitled"\n`
        );
        await codeFile(
          projectPath,
          'src/slug.js',
          `// Naive impl that satisfies visible tests but not the spec.\nexport function slug(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]/g, '-');\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { slug } from './src/slug.js';\n\n// Visible test doesn't check trim, collapse, length, or empty cases.\nassert.strictEqual(slug('Hello World'), 'hello-world');\nconsole.log('test ok');\n`
        );
      },
      evaluate: specAmbiguousCorrectness(),
    }),

    // 7. Config drift
    task({
      id: 'hard-debug-config-drift',
      name: 'Reconcile two config parsers',
      title: 'Two parsers disagree on the same config file',
      description:
        'Two files parse the same config.json differently. As a result, the app reads inconsistent ' +
        'values. Find both parsers and reconcile them. Use search to find all references to the config. ' +
        'The hidden spec verifies they return the same values.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'config.json',
          `{"timeout": "30", "retries": "3", "endpoint": "https://api.example.com"}\n`
        );
        // Parser 1: numbers as strings (correctly per JSON type).
        await codeFile(
          projectPath,
          'src/server.js',
          `import cfg from '../config.json' with { type: 'json' };\nexport function getServerConfig() { return cfg; }\n`
        );
        // Parser 2: numbers as numbers (drifted — uses parseInt).
        await codeFile(
          projectPath,
          'src/client.js',
          `import cfg from '../config.json' with { type: 'json' };\nexport function getClientConfig() {\n  return { timeout: parseInt(cfg.timeout), retries: parseInt(cfg.retries), endpoint: cfg.endpoint };\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { getServerConfig } from './src/server.js';\n\n// Visible test only checks the server config (passes).\nassert.deepStrictEqual(getServerConfig(), { timeout: '30', retries: '3', endpoint: 'https://api.example.com' });\nconsole.log('test ok');\n`
        );
      },
      evaluate: debugConfigDrift(),
    }),

    // 8. Migration
    task({
      id: 'hard-migrate-deprecated-api',
      name: 'Migrate from deprecated callback API to promise API',
      title: 'Migrate from fs.readFile(callback) to fs.promises.readFile()',
      description:
        'The codebase uses the deprecated fs.readFile(path, callback) API. Migrate ALL usages to the ' +
        'modern fs.promises.readFile() API. Use search to find every callback-style call. ' +
        'The hidden spec verifies no callbacks remain.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/loader.js',
          `import fs from 'node:fs';\nexport function loadFile(path, cb) {\n  fs.readFile(path, 'utf8', (err, data) => {\n    if (err) return cb(err);\n    cb(null, data);\n  });\n}\n`
        );
        await codeFile(
          projectPath,
          'src/index.js',
          `import fs from 'node:fs';\nimport { loadFile } from './loader.js';\n\nexport function readConfig(cb) {\n  fs.readFile('config.txt', 'utf8', (err, data) => cb(err, data));\n}\n`
        );
        await codeFile(
          projectPath,
          'src/util.js',
          `import fs from 'node:fs';\nexport function exists(path, cb) {\n  fs.readFile(path, (err) => cb(err ? true : false));\n}\n`
        );
        // The visible test checks that one async-style usage works. The
        // hidden spec checks that NO callback-style calls remain in any file.
        // Note: this test doesn't call loadFile, so the agent's migration
        // of loadFile to async won't break it.
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { readConfig } from './src/index.js';\n\n// Visible test calls the already-async readConfig. Even if the agent\n//migrates loadFile, this test still passes because it uses readConfig.\n// (Note: readConfig itself is callback-based; a correct migration makes\n// this test fail. The agent must also update test.js to use await.)\ntry {\n  await new Promise((resolve, reject) => {\n    readConfig((err, data) => err ? reject(err) : resolve(data));\n  });\n  console.log('test ok');\n} catch (e) {\n  console.error('test failed:', e.message);\n  process.exit(1);\n}\n`
        );
      },
      evaluate: migrateDeprecatedApi(),
    }),

    // 9. Subtle type coercion
    task({
      id: 'hard-fix-subtle-type-coercion',
      name: 'Fix a string-to-number coercion bug',
      title: 'Fix implicit string→number coercion in comparison',
      description:
        'A function compares values but uses == instead of ===. With certain inputs (strings vs numbers), ' +
        'the comparison is wrong. Fix the coercion. The hidden spec tests with mixed-type inputs.',
      complexity: 'medium',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/compare.js',
          `// BUG: == coerces strings to numbers. "5" == 5 is true.\nexport function isZero(n) {\n  return n == 0;\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { isZero } from './src/compare.js';\n\n// Visible test: only numeric input.\nassert.strictEqual(isZero(0), true);\nassert.strictEqual(isZero(1), false);\nconsole.log('test ok');\n`
        );
      },
      evaluate: fixSubtleTypeCoercion(),
    }),

    // 10. Adversarial
    task({
      id: 'hard-adversarial-test-fix',
      name: 'Fix the real bug, not the one the tests describe',
      title: 'A test passes for the wrong reason — find the real fix',
      description:
        'The visible test checks for a specific bug. A naive fix makes the visible test pass but ' +
        'introduces a subtle issue in a related code path. The hidden spec catches the wrong fix. ' +
        'Read the entire src/ to find the real fix.',
      complexity: 'complex',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/wrap.js',
          `// The function should return the last n items, or null if arr is empty.\nexport function lastN(arr, n) {\n  if (arr.length === 0) return null;\n  // BUG: this returns ALL items if n > arr.length, not arr.length.\n  return arr.slice(arr.length - n);\n}\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import assert from 'node:assert';\nimport { lastN } from './src/wrap.js';\n\n// Visible test only checks n <= arr.length.\nassert.deepStrictEqual(lastN([1, 2, 3], 2), [2, 3]);\nconsole.log('test ok');\n`
        );
      },
      evaluate: adversarialTestFix(),
    }),
  ];
}
