# Wire Strategies into `bench run` — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation)
**Owner:** Omega harness

## Problem

The benchmark machinery exists but is fragmented across commands:

- `bench run` — bare sequential single-model run. No strategies, no consensus, no retry.
- `bench consensus` — best-of-N across models (CLI-side, uses `runConsensusEval`).
- `bench strategy` — N prompt-variant strategies per task (CLI-side, uses `runStrategyEval`).
- `bench server-run` — server-side with concurrency + retries (the only in-process path).

Each of `run`/`consensus`/`strategy` re-implements the suite-loading switch (fast/deep/harder/hard-targeting/hard) and the report-writing + progress-printing logic. Passability currently depends on WHICH command you happen to run: `bench run` gives you the bare path; the strategy/consensus lift (measurably higher pass rates on harder-v2-class tasks, per the exploration's data: 10/10 vs 9/10-0/1 spread) requires knowing `bench strategy`/`bench consensus` exist.

## Goal

Make `bench run` the single entry point for all three eval modes. `bench run --strategy single|consensus|strategy` dispatches to the existing machinery; the default stays `single` (bare behavior unchanged). No new eval logic — pure wiring + shared suite-loading refactor.

## Non-goals

- Changing `runConsensusEval`/`runStrategyEval` internals (they're validated + working).
- Making `server-run` the default (separate work; it's a different execution model).
- New eval strategies or consensus models.

## Design

### 1. Extract shared suite-loading into `packages/bench/src/suites/loader.ts`

Today the suite switch is copy-pasted in `runCmd`, `consensusCmd`, `strategyCmd` (and `evalCmd`/`adversarialCmd` variants). Extract one helper that ALL of them use:

```ts
import { BenchmarkTask } from '../types.js';
import { syntheticSuite } from './synthetic.js';
import { fastSuite } from './fast.js';
import { deepSuite } from './deep.js';
import { harderSuite } from './harder.js';
import { harderV2Suite } from './harder-v2.js';
import { hardTargetedSuite } from './hard-targeting.js';
import { hardSuite } from './hard.js';
import { loadDeepSWESuite } from '../adapters/deepswe.js';
import { loadSWebenchLiteSuite } from '../adapters/swebench.js';

export interface SuiteLoadOptions {
  suite: string;
  path?: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  repos?: string[];
  useDocker?: boolean;
}

/**
 * Load the task list for a suite, applying the common filters
 * (taskIds, nTasks, sampleSeed). Shared by bench run / consensus /
 * strategy / eval / adversarial so the suite->tasks mapping is in one place.
 */
export async function loadSuiteTasks(options: SuiteLoadOptions): Promise<{ tasks: BenchmarkTask[]; suiteName: string }> {
  // ... the switch from runCmd:130-213, with the filter logic extracted ...
}
```

The `runCmd`'s existing switch (bench.ts:130-213) is the authoritative behavior — move it verbatim, including the `throw new Error('Unknown suite')` and the `tasks.filter((t) => opts.taskId.includes(t.id))` post-filter.

### 2. `bench run` gains `--strategy` + passthrough flags

```ts
const runCmd = new Command('run')
  .description('Run a benchmark suite (single, consensus, or strategy modes)')
  // ... existing flags unchanged ...
  .option('--strategy <mode>', 'eval mode: single | consensus | strategy (default: single)', 'single')
  .option('--models <list>', 'comma-separated provider/model list (required for --strategy consensus)')
  .option('--strategies <list>', 'comma-separated strategies (default: default,verify-before-finish,research-first)')
  .option('--auto', 'auto-select strategies via classifyTask (strategy mode only)')
```

### 3. Dispatch in the action

After `loadSuiteTasks` + the existing `apiUrl`/`waitForApi` setup, replace the single `runBenchmark` call with a dispatch:

```ts
    if (opts.strategy === 'consensus') {
      if (!opts.models) throw new Error('--models is required for --strategy consensus (e.g. "external:agy,minimax/MiniMax-M3")');
      const models = opts.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
        if (m.startsWith('external:')) return { provider: 'external', model: m.slice('external:'.length) };
        if (m.includes('/')) {
          const [provider, ...rest] = m.split('/');
          return { provider, model: rest.join('/') };
        }
        return { provider: 'external', model: m };
      });
      const results = await runConsensusEval(tasks, {
        apiUrl,
        models,
        timeoutMs,
        projectPrefix: opts.projectPrefix,
        tokenBudget: opts.tokenBudget,
        suiteName,
      });
      // Print per-model + consensus summary (reuse the consensusCmd output shape).
      // Persist per-model reports + a consensus summary report.
      return;
    }

    if (opts.strategy === 'strategy') {
      const strategies = (opts.strategies ?? 'default,verify-before-finish,research-first').split(',').map((s) => s.trim()).filter(Boolean) as StrategyName[];
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
      });
      // Print union + per-strategy + failure insights (reuse strategyCmd output shape).
      // Persist the strategy report.
      return;
    }

    // single (default): existing runBenchmark path, unchanged.
```

The consensus/strategy print + persist blocks are copied from `consensusCmd`/`strategyCmd` (they're ~40 lines each) so `bench run --strategy consensus` produces the same output as `bench consensus` today. The duplicate suite-loading in `consensusCmd`/`strategyCmd` is REPLACED with `loadSuiteTasks` (same behavior, less code).

### 4. Baseline comparison compatibility

`--baseline`/`--fail-on-regression` currently run after `runBenchmark` produces a `BenchmarkReport`. For consensus/strategy modes, the report shape differs (consensus returns `ConsensusResult[]`, strategy returns `StrategyResult`). Simplest: keep baseline comparison ONLY for `single` mode; for consensus/strategy, log a note ("--baseline comparison only applies to single mode"). Document in the help text.

## Data flow

```
bench run --strategy consensus --models external:agy,minimax/MiniMax-M3 --suite harder-v2
  → loadSuiteTasks → 10 tasks
  → runConsensusEval(tasks, { apiUrl, models, ... })
    → per-task: N agents in parallel (project setup once, reset to base commit per model)
    → first passing patch wins; union pass rate
  → print per-model + consensus summary (same as bench consensus)
  → persist per-model reports + consensus report

bench run --strategy strategy --strategies default,verify-before-finish --suite harder
  → loadSuiteTasks → tasks
  → runStrategyEval(tasks, { apiUrl, strategies, ... })
    → per-task: each strategy in order, first passing wins
  → print union + per-strategy + failure insights (same as bench strategy)
  → persist strategy report

bench run --suite harder-v2 (default single)
  → existing runBenchmark path, identical to today
```

## Risks

- **Duplicate code in consensus/strategy mode**: the print/persist blocks are copied from the existing commands (~40 lines each). Acceptable — they're already written, tested, and stable; extracting a shared "report output" helper would be a larger refactor with no behavioral benefit.
- **`--baseline` in consensus/strategy mode is a no-op**: documented; single mode keeps the regression gate.
- **`--strategy` is a new option**: default `single` keeps all existing invocations byte-identical. The only behavior change is `--strategy consensus|strategy` now works on `run`.
- **`loadSuiteTasks` extraction touches 4+ call sites**: all use the same switch; the extraction is mechanical. The `evalCmd`/`adversarialCmd` variants have slightly different suite lists (eval supports swebench-lite + pier) — keep `loadSuiteTasks` scoped to what `run`/`consensus`/`strategy` share, and leave `eval`/`adversarial`'s switches as-is (avoid over-extraction).

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/bench/src/suites/loader.ts` (new) | `loadSuiteTasks` helper | +70 |
| `apps/cli/src/commands/bench.ts` | `runCmd` gains `--strategy`/`--models`/`--strategies`/`--auto`; dispatch in action; `consensusCmd`/`strategyCmd` switch → `loadSuiteTasks` | +90 / -60 |

Total: 2 files, ~160 LOC.

## Acceptance criteria

1. `bench run --suite harder-v2` (no `--strategy`) behaves identically to today (10/10 baseline, same report format).
2. `bench run --strategy consensus --models <list> --suite faster` runs the consensus path and prints the per-model + consensus summary.
3. `bench run --strategy strategy --strategies default,verify-before-finish --suite faster` runs the strategy path and prints union + per-strategy pass rates.
4. `bench run --strategy consensus` without `--models` errors with a clear message.
5. `--baseline` in consensus/strategy mode logs the "single-only" note and skips comparison (no crash).
6. `bench consensus`/`bench strategy` (the standalone commands) still work after the `loadSuiteTasks` extraction — same output as before.
7. Build clean: `pnpm --filter @omega/bench build` + `pnpm --filter @omega/cli build` exit 0. Tests still pass (bench 8/8).
