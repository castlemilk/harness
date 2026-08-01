# Hard-targeting suite: findings and harness improvement opportunities

## What we built

`packages/bench/src/suites/hard-targeting.ts` — 10 tasks designed to fail
on current agents without **investigation, research, or escalation** behaviors.
Each task targets a specific weakness:

| Task | Failure mode it tests |
|---|---|
| `hard-debug-event-listener-leak` | Agent must grep for ALL `addEventListener` calls, not just the obvious one |
| `hard-refactor-public-api` | Agent must find all callers (in other files) before renaming |
| `hard-fix-async-race` | Agent must read the test, see it tests concurrency, then fix |
| `hard-fix-on2-regression` | Agent must measure or know algorithmic complexity |
| `hard-add-feature-without-breaking` | Agent must add new param with default value, keep existing callers |
| `hard-spec-ambiguous-correctness` | Agent must read SPEC.md, not just pass visible tests |
| `hard-debug-config-drift` | Agent must read BOTH parsers, reconcile the difference |
| `hard-migrate-deprecated-api` | Agent must update ALL callers, not just one file |
| `hard-fix-subtle-type-coercion` | Agent must handle edge case (string vs number comparison) |
| `hard-adversarial-test-fix` | Visible test passes for the wrong reason; hidden spec catches the wrong fix |

Each task uses a `runHiddenSpec()` evaluator that runs a `test.js` containing
hidden tests (in addition to the visible test the agent sees). This catches
the "fix passes visible tests but violates the spec" case.

## Baseline failure rate (all 3 internal models, 180s timeout)

```
minimax/MiniMax-M3:        10/10 passed (734s)
deepseek/deepseek-v4-pro:   10/10 passed (579s)
qwen/qwen3.8-max-preview:  10/10 passed (1428s)
```

**All 3 models passed all 10 tasks.** This is bad for the eval — the tasks
are not hard enough. The baseline shows current models are competent at:
- Reading multiple files
- Using search
- Understanding specs
- Common refactors

But the strategy runner revealed deeper issues (see below).

## Strategy eval findings (Multi-strategy framework)

`packages/bench/src/strategy-eval.ts` — run each task with N prompt
strategies and measure which helps. The strategies are:

| Strategy | What it adds |
|---|---|
| `default` | Baseline, no extra prompt |
| `verify-before-finish` | Forces a verification step: re-read spec, check against hidden tests |
| `research-first` | Forces enumerating all relevant files BEFORE editing |
| `concise` | Shorter prompt — minimal context |
| `plan-then-execute` | Forces explicit planning before doing |

Run the same task with each strategy; the first-passing strategy wins.

### Finding 1: Non-determinism is a real failure mode

On `hard-fix-async-race`, the `default` strategy produced **two different
fixes across runs**:

- Run 1 (baseline): promise-chain serialisation — works for both sequential
  and concurrent calls. **Passes.**
- Run 2 (strategy eval): queue with `setImmediate(drain)` — queues the
  resolve callbacks but never increments `value`. **Fails** (returns 0
  instead of 10).

Same task, same model, same strategy. Different random seed produced a
**broken fix** that the test couldn't catch because the test is sequential.

**Implication:** token-level non-determinism in agent outputs is a real
source of variance. A single consensus run can hide this; multiple runs
reveal it.

### Finding 2: `verify-before-finish` slows down without helping

On `hard-fix-async-race`:
- default: 36s, 0/1
- verify-before-finish: 363s (10x slower!), 0/1
- research-first: 47s, 0/1

The `verify` strategy is correctly attempting to read the spec — but
in this case, the agent's verification step is internal to the model,
not visible to our eval. So we can't measure whether it actually caught
a real bug. The strategy slows the agent down 10x with no measurable
benefit on this task.

**Implication:** `verify-before-finish` would need a tool that gives
the harness visibility into the agent's verification step
(e.g. an explicit "I have verified X" message, or a separate
verification pass that produces a verifiable artifact).

### Finding 3: Tasks that need real fix test-design are not the agent's fault

The `hard-migrate-deprecated-api` task had a visible test that used the
OLD callback API. The agent correctly migrated the source to async, but
the visible test (still using callbacks) broke. The agent then either:
1. Left the test broken (correct migration, broken test)
2. Updated the test to use async (correct, but defeats the "no callbacks
   remain" check)

We fixed this by reworking the visible test to be async-compatible.

**Implication:** Task design is hard. The eval must distinguish "fix the
bug" from "fix the bug without breaking the test" — and the test must
be compatible with the correct fix.

## Harness improvement opportunities

Based on these findings, here are the harness features that would
unlock pass rate on the next tier of tasks:

### 1. **Search-all-files-before-editing** (high impact)

Current agents use `search` to find references. But they often miss
cases like:
- Files imported transitively (via shared index.js)
- Files in directories they didn't search
- Comments mentioning the function name

A `grep_all` tool that does a project-wide regex search with a few
keystrokes would help. The `search` tool exists but agents don't always
think to use it before editing.

### 2. **Verification protocol with measurable artifacts** (high impact)

The `verify-before-finish` strategy slowed things down 10x but we couldn't
measure if it helped. The harness could:
- Add a "verification" tool that re-runs tests and checks against the
  task description line by line
- Have the agent EXPLICITLY output a "I verified X" message that the
  harness records
- Score the verification message against the spec

### 3. **Detect non-deterministic agent outputs** (medium impact)

Run each task 2-3 times with the same strategy and measure the variance.
High variance = the strategy is fragile. The current eval reports a
single pass/fail per task, masking this.

### 4. **Spec-aware test design** (high impact — orthogonal to agent quality)

The migration task shows the eval framework must be designed to
distinguish "fix the bug" from "fix the bug while keeping tests green".
A task design tool that auto-generates hidden tests from a SPEC.md
would reduce this class of false-negative.

### 5. **Escalation on small/short fixes** (medium impact)

Many of the 10/10 winning fixes were short (a few lines). The agents
don't know when a fix is "too small" and likely wrong. A heuristic
that escalates to a verification pass when the patch is < N lines
would catch adversarial cases.

### 6. **Adversarial test generation** (long-term)

Automatically generate hidden tests by:
- Looking at the visible test
- Asking a stronger model "what's the wrong fix that would still pass
  visible tests?"
- Adding a test that catches the wrong fix

This would make the hard suite self-scaling: as agents get better, the
adversarial tests get harder.

## What we'd build next (priority order)

1. **`bench strategy` runs on the full hard suite** with 3 strategies
   (default, verify, research) and 3 models (agy, MiniMax, DeepSeek).
   This gives the per-strategy-per-task-type heatmap.
2. **Variance tracking** — run each task 3 times, report the variance.
3. **Adversarial test generation** — for each hard task, generate a
   stronger hidden test that catches more wrong fixes.
4. **Better tasks** — the current 10 are too easy for the current
   agents. Add 4-5 truly evil tasks that even the best agent can't
   solve (e.g. a stack trace from a production error, a multi-system
   integration bug, a spec contradiction).
