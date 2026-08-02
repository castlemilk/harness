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

Today the suite switch is copy-pasted in `runCmd`, `consensusCmd`, `strategyCmd` (and `evalCmd`/`adversarialCmd` variants). Extract one helper used by **run/consensus/strategy only** (eval + adversarial have genuinely different suite sets — leave their switches as-is):

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

export type SuiteMode = 'run' | 'consensus' | 'strategy';

export interface SuiteLoadOptions {
  suite: string;
  path?: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  repos?: string[];
  useDocker?: boolean;
  /** Restrict which suites are allowed (see allowed-suites table below). */
  mode?: SuiteMode;
}

export const SUITES_BY_MODE: Record<SuiteMode, string[]> = {
  run: ['synthetic', 'fast', 'hard', 'harder', 'harder-v2', 'hard-targeting', 'deep-swe', 'swebench-lite'],
  consensus: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting', 'hard'],
  strategy: ['fast', 'deep', 'harder', 'harder-v2', 'hard-targeting'],
};

/**
 * Load the task list for a suite, applying the common filters
 * (taskIds, nTasks, sampleSeed) + the mode's suite allow-list.
 * Shared by bench run / consensus / strategy so the suite->tasks
 * mapping is in one place.
 */
export async function loadSuiteTasks(options: SuiteLoadOptions): Promise<{ tasks: BenchmarkTask[]; suiteName: string }> {
  // The switch covers the runCmd base (bench.ts:130-213) + the `deep`
  // branch consensus/strategy support. The mode allow-list keeps each
  // command from silently gaining suites it has no flags for (e.g.
  // consensus has no --docker/--n-tasks, so deep-swe/swebench-lite
  // must NOT route through it). Unknown suite OR suite-not-in-mode
  // throws.
}
```

The `runCmd`'s existing switch (bench.ts:130-213) is the base behavior — move it, add the `deep` branch, keep the `throw new Error('Unknown suite')` + the `tasks.filter((t) => taskIds.includes(t.id))` post-filter, and gate on `SUITES_BY_MODE[mode]`. Update ALL THREE help texts (`runCmd` gains `deep`; `consensusCmd`/`strategyCmd` gain `harder-v2`; defaults `harder`/`hard-targeting` unchanged). The `--strategy <mode>` option value is validated (single|consensus|strategy; unknown → error, not silent fallback to single).

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

The `pier` early-return (bench.ts:110-137) fires BEFORE the apiUrl/waitForApi/loadSuiteTasks block. Guard it: `if (opts.strategy !== 'single') throw new Error('--strategy only applies to the harness suites, not pier');` — so `bench run --strategy consensus --suite pier` errors instead of silently ignoring the flag.

After `loadSuiteTasks` + the existing `apiUrl`/`waitForApi` setup, replace the single `runBenchmark` call with a dispatch. The consensus/strategy blocks copy the FULL output shape from `consensusCmd`/`strategyCmd` (not just the summary — header line, onTaskProgress per-task lines, summary, report persistence, history persistence):

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
      // Same summary + persistence as consensusCmd:
      //  - the consensus summary line (pass rate, winsByModel)
      //  - writeModelEvalReport(results, suiteName) — writes ONE model-eval-<ts>.json
      //    + .md containing all per-model reports PLUS the consensus pseudo-model
      //    (results[0]); NOT multiple files
      //  - saveBenchmarkHistory(prisma, report, {...}) with ONE entry: the
      //    consensus pseudo-model (provider: 'consensus', model: models.join('+')),
      //    best-effort
      return;
    }

    if (opts.strategy === 'strategy') {
      const strategies = (opts.strategies ?? 'default,verify-before-finish,research-first').split(',').map((s) => s.trim()).filter(Boolean) as StrategyName[];
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
      // Same output as strategyCmd: union pass rate, per-strategy table,
      // winsByStrategy, failure insights via analyseFailures, then persist
      // the strategy-<suite>-<ts>.json report.
      return;
    }

    // single (default): existing runBenchmark path, unchanged.
```

The consensus/strategy output blocks are copied VERBATIM from `consensusCmd`/`strategyCmd` (header, onTaskProgress, summary, report persistence, history persistence — ~40-50 lines each) so `bench run --strategy consensus` produces the same output as `bench consensus` today. The duplicate suite-loading in `consensusCmd`/`strategyCmd` is REPLACED with `loadSuiteTasks` (same behavior, less code). `--output-dir` does NOT apply to consensus/strategy mode (the existing commands hardcode `omegaReportsDir()`) — document the limitation next to the `--baseline` note.

Note on defaults: the standalone commands use different defaults (`--timeout`: run 1800000 vs consensus 600000 vs strategy 300000; `--project-prefix`: bench vs consensus vs strategy). `bench run --strategy consensus` inherits runCmd's defaults (1800000/bench) — acceptable (explicit flags override), but documented so users don't expect byte-identical standalone-command behavior with zero flags.

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
| `packages/bench/src/suites/loader.ts` (new) | `loadSuiteTasks` helper | +75 |
| `packages/bench/src/index.ts` | Re-export `loadSuiteTasks` (the CLI imports from `@omega/bench`) | +1 |
| `apps/cli/src/commands/bench.ts` | `runCmd` gains `--strategy`/`--models`/`--strategies`/`--auto`; dispatch in action; pier guard; `consensusCmd`/`strategyCmd` switch → `loadSuiteTasks` + help-text updates | +110 / -60 |

Total: 3 files, ~190 LOC.

## Acceptance criteria

1. `bench run --suite harder-v2` (no `--strategy`) behaves identically to today (10/10 baseline, same report format).
2. `bench run --strategy consensus --models <list> --suite fast` runs the consensus path and prints the header + per-task progress + consensus summary.
3. `bench run --strategy strategy --strategies default,verify-before-finish --suite fast` runs the strategy path and prints header + per-task progress + union + per-strategy pass rates + failure insights.
4. `bench run --strategy consensus` without `--models` errors with a clear message.
5. `--baseline` in consensus/strategy mode logs the "single-only" note and skips comparison (no crash).
6. `bench consensus`/`bench strategy` (the standalone commands) still work after the `loadSuiteTasks` extraction — same output as before, INCLUDING their `deep` suite support (the loader covers it) AND their mode allow-lists (consensus/strategy do NOT gain synthetic/deep-swe/swebench-lite).
7. `bench run --strategy consensus --suite pier` errors with a clear message (pier guard fires BEFORE the --path check).
8. `bench run --strategy bogus` errors with a clear message (value validation).
9. `bench run --strategy consensus --suite deep` works (deep is in the consensus allow-list).
10. Build clean: `pnpm --filter @omega/bench build` + `pnpm --filter @omega/cli build` exit 0. Tests still pass (bench 8/8).
