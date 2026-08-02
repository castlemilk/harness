# Wire Strategies into `bench run` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `bench run` the single entry point for all three eval modes — `--strategy single|consensus|strategy`. Reuses `runConsensusEval` + `runStrategyEval` unchanged; extracts shared suite-loading into one helper.

**Architecture:** A new `loadSuiteTasks` helper in `packages/bench/src/suites/loader.ts` with a mode allow-list (`SUITES_BY_MODE`). The CLI `runCmd` gains `--strategy`/`--models`/`--strategies`/`--auto` flags + a dispatch; `consensusCmd`/`strategyCmd` switch to the shared loader. Pier guard + `--strategy` value validation.

**Tech Stack:** TypeScript, Node 18+, Commander.

**Spec:** `docs/superpowers/specs/2026-08-02-bench-run-strategies-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/bench/src/suites/loader.ts` (new) | Create | `loadSuiteTasks(options)` — the suite switch + mode allow-list + filters. |
| `packages/bench/src/index.ts` | Modify | Re-export `loadSuiteTasks`. |
| `apps/cli/src/commands/bench.ts` | Modify | `runCmd` gains `--strategy`/`--models`/`--strategies`/`--auto`; dispatch in action; pier guard; `consensusCmd`/`strategyCmd` switch → `loadSuiteTasks`; help-text updates. |

---

## Chunk 1: All Tasks

### Task 1.1: Create `loadSuiteTasks` in `packages/bench/src/suites/loader.ts`

- [ ] **Step 1: Create the file** with the suite switch (the union of run/consensus/strategy suites) + mode allow-list:

```ts
import type { BenchmarkTask } from '../types.js';
import { syntheticSuite } from './synthetic.js';
import { fastSuite } from './fast.js';
import { deepSuite } from './deep.js';
import { harderSuite } from './harder.js';
import { harderV2Suite } from './harder-v2.js';
import { hardTargetedSuite } from './hard-targeting.js';
import { hardSuite } from './hard.js';
import { loadDeepSWESuite } from '../adapters/deepswe.js';
import { loadSWebenchLiteSuite } from '../adapters/swebench.js';

export type SuiteMode = 'run' | 'consensus' | 'strategy';

export interface SuiteLoadOptions {
  suite: string;
  path?: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  repos?: string[];
  useDocker?: boolean;
  mode?: SuiteMode;
}

export const SUITES_BY_MODE: Record<SuiteMode, string[]> = {
  run: ['synthetic', 'fast', 'hard', 'harder', 'harder-v2', 'hard-targeting', 'deep-swe', 'swebench-lite'],
  consensus: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting', 'hard'],
  strategy: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting'],
};

function filterByIds(tasks: BenchmarkTask[], taskIds: string[]): BenchmarkTask[] {
  return taskIds.length > 0 ? tasks.filter((t) => taskIds.includes(t.id)) : tasks;
}

/**
 * Load the task list for a suite, applying the common filters
 * (taskIds, nTasks, sampleSeed) + the mode's suite allow-list.
 */
export async function loadSuiteTasks(options: SuiteLoadOptions): Promise<{ tasks: BenchmarkTask[]; suiteName: string }> {
  const mode = options.mode ?? 'run';
  const allowed = SUITES_BY_MODE[mode];
  if (!allowed.includes(options.suite)) {
    throw new Error(`Unknown suite for ${mode} mode: ${options.suite}. Allowed: ${allowed.join(' | ')}`);
  }

  const { suite } = options;
  let tasks: BenchmarkTask[];
  let suiteName: string;

  if (suite === 'deep-swe') {
    if (!options.path) throw new Error('--path is required for the deep-swe suite');
    tasks = await loadDeepSWESuite({
      tasksDir: options.path,
      nTasks: options.nTasks,
      sampleSeed: options.sampleSeed,
      taskIds: options.taskIds,
      useDocker: options.useDocker,
    });
    suiteName = 'deep-swe';
  } else if (suite === 'synthetic') {
    tasks = filterByIds(syntheticSuite(), options.taskIds ?? []);
    suiteName = 'synthetic';
  } else if (suite === 'fast') {
    tasks = filterByIds(fastSuite(), options.taskIds ?? []);
    suiteName = 'fast';
  } else if (suite === 'deep') {
    tasks = filterByIds(deepSuite(), options.taskIds ?? []);
    suiteName = 'deep';
  } else if (suite === 'hard') {
    if (!options.path) throw new Error('--path is required for the hard suite');
    tasks = filterByIds(await hardSuite(options.path), options.taskIds ?? []);
    suiteName = 'hard';
  } else if (suite === 'harder') {
    tasks = filterByIds(harderSuite(), options.taskIds ?? []);
    suiteName = 'harder';
  } else if (suite === 'harder-v2') {
    tasks = filterByIds(harderV2Suite(), options.taskIds ?? []);
    suiteName = 'harder-v2';
  } else if (suite === 'hard-targeting') {
    tasks = filterByIds(hardTargetedSuite(), options.taskIds ?? []);
    suiteName = 'hard-targeting';
  } else if (suite === 'swebench-lite') {
    if (!options.path) throw new Error('--path is required for the swebench-lite suite (path to JSON file)');
    tasks = await loadSWebenchLiteSuite({
      datasetPath: options.path,
      nTasks: options.nTasks,
      sampleSeed: options.sampleSeed,
      taskIds: options.taskIds,
      repos: options.repos,
    });
    suiteName = 'swebench-lite';
  } else {
    throw new Error(`Unknown suite: ${suite}`);
  }

  return { tasks, suiteName };
}
```

**IMPORTANT** — read `apps/cli/src/commands/bench.ts:130-213` FIRST to confirm the exact suite-loading calls + option shapes in the runCmd switch (they may differ slightly from the sketch — e.g. `loadDeepSWESuite` option names, `hardSuite(path)` signature). Match the real signatures.

- [ ] **Step 2: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 3: No commit — continue to Task 1.2.**

### Task 1.2: Re-export `loadSuiteTasks` from `packages/bench/src/index.ts`

- [ ] **Step 1: Read `packages/bench/src/index.ts`** — it re-exports the suites + adapters. Add:

```ts
export * from './suites/loader.js';
```

(Or add `loadSuiteTasks`/`SUITES_BY_MODE`/`SuiteMode`/`SuiteLoadOptions` to the existing export structure — match the file's style.)

- [ ] **Step 2: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 3: No commit — continue to Task 1.3.**

### Task 1.3: `runCmd` gains `--strategy` + dispatch + pier guard

- [ ] **Step 1: Add the flags to `runCmd`** (bench.ts:63-64, after the existing options):

```ts
  .option('--strategy <mode>', 'eval mode: single | consensus | strategy (default: single)', 'single')
  .option('--models <list>', 'comma-separated provider/model list (required for --strategy consensus, e.g. "external:agy,minimax/MiniMax-M3")')
  .option('--strategies <list>', 'comma-separated strategies for --strategy strategy (default: default,verify-before-finish,research-first)')
  .option('--auto', 'auto-select strategies via classifyTask (strategy mode only)')
```

- [ ] **Step 2: Add the pier guard** at the TOP of the action (BEFORE the `if (opts.suite === 'pier')` block, so it fires before the --path check):

```ts
    if (opts.strategy !== 'single' && opts.suite === 'pier') {
      throw new Error('--strategy only applies to the harness suites, not pier');
    }
    if (!['single', 'consensus', 'strategy'].includes(opts.strategy)) {
      throw new Error(`Unknown --strategy value: ${opts.strategy}. Allowed: single | consensus | strategy`);
    }
```

- [ ] **Step 3: Replace the suite-loading switch (bench.ts:130-213) with `loadSuiteTasks`:**

```ts
    const { tasks, suiteName } = await loadSuiteTasks({
      suite: opts.suite,
      path: opts.path,
      nTasks: opts.nTasks,
      sampleSeed: opts.sampleSeed,
      taskIds: opts.taskId,
      repos: opts.repo,
      useDocker: opts.docker,
      mode: opts.strategy === 'single' ? 'run' : opts.strategy,
    });
```

(Note: `mode: 'run'` for single keeps the runCmd's original suite set — synthetic/fast/hard/harder/harder-v2/hard-targeting/deep-swe/swebench-lite — plus deep is NOT in run's allow-list, preserving the pre-change behavior. Wait — the runCmd's original switch had NO deep. Correct: `SUITES_BY_MODE.run` excludes deep. Verified in the spec.)

- [ ] **Step 4: Replace the `runBenchmark` call with the dispatch:**

```ts
    if (opts.strategy === 'consensus') {
      if (!opts.models) {
        throw new Error('--models is required for --strategy consensus (e.g. "external:agy,minimax/MiniMax-M3")');
      }
      const models = opts.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
        if (m.startsWith('external:')) return { provider: 'external', model: m.slice('external:'.length) };
        if (m.includes('/')) {
          const [provider, ...rest] = m.split('/');
          return { provider, model: rest.join('/') };
        }
        return { provider: 'external', model: m };
      });
      console.log(`Running ${String(tasks.length)} tasks across ${String(models.length)} agents in parallel: ${models.map((m) => `${m.provider}/${m.model}`).join(', ')}`);
      const results = await runConsensusEval(tasks, {
        apiUrl,
        models,
        timeoutMs,
        projectPrefix: opts.projectPrefix,
        tokenBudget: opts.tokenBudget,
        suiteName,
        onTaskProgress: (taskId, report) => {
          const w = report.winner ? `${report.winner.provider}/${report.winner.model}` : 'none';
          console.log(`  ${report.passed ? '✓' : '✗'} ${taskId} (${String(report.candidates.length)} agents, winner: ${w})`);
        },
      });
      // Copy the consensus summary + writeModelEvalReport + saveBenchmarkHistory
      // blocks VERBATIM from consensusCmd (bench.ts:549-574).
      return;
    }

    if (opts.strategy === 'strategy') {
      const strategies = (opts.strategies ?? 'default,verify-before-finish,research-first').split(',').map((s) => s.trim()).filter(Boolean) as string[];
      if (opts.auto) {
        console.log(`Running ${String(tasks.length)} tasks with auto-selected strategies`);
      } else {
        console.log(`Running ${String(tasks.length)} tasks across ${String(strategies.length)} strategies: ${strategies.join(', ')}`);
      }
      const result = await runStrategyEval(tasks, {
        apiUrl,
        strategies,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        provider: opts.provider,
        model: opts.model,
        suiteName,
        autoStrategies: opts.auto ?? false,
        onProgress: (taskId, report) => {
          const w = report.winner ?? 'none';
          console.log(`  ${report.passed ? '✓' : '✗'} ${taskId} (${String(report.candidates.length)} strategies, winner: ${w})`);
        },
      });
      // Copy the union/per-strategy/winsByStrategy/failure-insights/report
      // blocks VERBATIM from strategyCmd (bench.ts:655-714).
      return;
    }

    // single (default): existing runBenchmark path + baseline comparison, unchanged.
```

**IMPORTANT**: read `consensusCmd` (bench.ts:460-577) + `strategyCmd` (bench.ts:578-718) to copy their exact output blocks. The dispatch needs the same `runConsensusEval`/`runStrategyEval` imports (add to the top of bench.ts if not already imported).

- [ ] **Step 5: Verify typecheck** — `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3` exits 0.

- [ ] **Step 6: No commit — continue to Task 1.4.**

### Task 1.4: `consensusCmd`/`strategyCmd` switch → `loadSuiteTasks`

- [ ] **Step 1: Replace the suite-loading switch in `consensusCmd`** (bench.ts:487-516) with:

```ts
      const { tasks } = await loadSuiteTasks({
        suite: opts.suite,
        path: opts.path,
        taskIds: opts.taskId,
        mode: 'consensus',
      });
```

(Remove the old per-suite if/else. The `deep` suite stays supported via the consensus allow-list.)

- [ ] **Step 2: Replace the suite-loading switch in `strategyCmd`** (bench.ts:608-632) with:

```ts
      const { tasks } = await loadSuiteTasks({
        suite: opts.suite,
        path: opts.path,
        taskIds: opts.taskId,
        mode: 'strategy',
      });
```

- [ ] **Step 3: Update both help texts** (consensusCmd line 464: add `harder-v2`; strategyCmd line 579: add `harder-v2`). Also verify the defaults (`harder` / `hard-targeting`) are still in the allow-lists (they are).

- [ ] **Step 4: Verify typecheck** — `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3` exits 0.

- [ ] **Step 5: No commit — continue to Task 1.5.**

### Task 1.5: Verify + commit (user approval)

- [ ] **Step 1: All builds pass**

```bash
timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/server build 2>&1 | tail -3
```

- [ ] **Step 2: Tests pass**

```bash
timeout 120 pnpm --filter @omega/bench test 2>&1 | tail -5
timeout 90 pnpm --filter @omega/agent test 2>&1 | tail -5
timeout 90 pnpm --filter @omega/server test 2>&1 | tail -5
```

- [ ] **Step 3: CLI smoke** (server running on :4000):

```bash
node apps/cli/dist/index.js bench run --help 2>&1 | grep -A1 "strategy"
# verify the new flags appear
node apps/cli/dist/index.js bench run --suite fast --strategy bogus 2>&1 | tail -2
# expect the "Unknown --strategy value" error
node apps/cli/dist/index.js bench run --suite fast --strategy consensus 2>&1 | tail -2
# expect the "--models is required" error
node apps/cli/dist/index.js bench run --suite fast --strategy strategy --strategies default --n-tasks 2 2>&1 | tail -4
# expect the strategy header + per-task progress (runs 2 fast tasks across 1 strategy)
```

- [ ] **Step 4: Commit (request user approval first).** If approved:

```bash
git add packages/bench/src/suites/loader.ts packages/bench/src/index.ts apps/cli/src/commands/bench.ts
git commit -m "feat(bench,cli): wire strategies into bench run — single/consensus/strategy modes

Makes bench run the single entry point for all three eval modes:
  * bench run --strategy consensus --models <list> — best-of-N via
    runConsensusEval (header + per-task progress + consensus summary
    + model-eval report + history, matching bench consensus).
  * bench run --strategy strategy [--strategies | --auto] — prompt-
    variant via runStrategyEval (header + per-task progress + union/
    per-strategy/wins + failure insights + report, matching bench
    strategy).
  * bench run (default single) — unchanged behavior.

Shared suite-loading extracted to packages/bench/src/suites/loader.ts:
loadSuiteTasks with a per-mode allow-list (SUITES_BY_MODE), so
consensus/strategy don't silently gain synthetic/deep-swe/swebench-lite
(they lack --docker/--n-tasks) and run doesn't gain deep. consensusCmd/
strategyCmd now use the loader (less duplication, same behavior).

Guards: pier rejects --strategy; unknown --strategy values error;
consensus without --models errors."
```
