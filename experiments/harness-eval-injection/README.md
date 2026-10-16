# harder-v2 context-injection experiment

Does injecting extra context improve a model's score on the harness's own
code-repair suite? This directory holds the inputs, the runner and the analysis
for a controlled three-arm test.

## The arms

All three arms run the **same** suite, model and timeout; the only difference is
a context block prepended to the task description the agent receives.

| arm | injected block | source |
| --- | --- | --- |
| `baseline` | none | — |
| `skills` | curated engineering procedure per bug class | `sources/skills.json` (hand-authored) |
| `kg` | prior-art graph: operations, symbols and provenance from repairs of the same bug class elsewhere in the corpus | `build-context.mjs`, derived from the harness-eval corpus |

The model is `opencode/deepseek-v4.1-flash-free` reached through the external
`opencode` CLI (`opencode run --model ...`), which is free-tier: no API spend,
but it does consume plan quota, and a long sweep can hit rate limits.

## Why the injection lands in the description

For an external-CLI run the harness does not build the model's prompt itself —
it hands the CLI a rendered prompt whose body is the task description
(`packages/agent/src/external.ts`). Prompt-level injection therefore has to go
through the description, which is what `--context-dir` does
(`packages/bench/src/runner.ts`). Note this means the harness's own skill
resolver — which feeds the *internal* agent — is bypassed entirely on this route.

## Integrity rules

A leaked solution would make the result meaningless, so `build-context.mjs`
enforces three rules and fails the build if any is broken:

1. **A task's own patches and failures are never read** when building its block.
   Only sibling tasks — same bug class, different task — contribute.
2. **Sibling evidence is reduced to operations, file names and symbol names.**
   No diff hunk and no source line from any patch is copied into a block.
3. **After rendering, every added/removed line of the task's own patches is
   searched for in the block, and any hit fails the build.** The guard currently
   reports clean for all 10 tasks.

The curated `skills` arm is authored from general engineering practice and
contains no corpus data at all.

## Running it

```bash
# 1. build (context is read by the harness CLI at task-creation time)
pnpm --filter @omega/bench build && pnpm --filter @omega/cli build

# 2. serve the API (separate terminal)
task dev:server

# 3. regenerate the context blocks (only needed if skills.json or the corpus changed)
node build-context.mjs

# 4. sweep — one iteration per arm by default
ITER=1 ARMS=baseline,skills,kg ./run-arms.sh

# 5. add a second iteration later without repeating the first
START_ITER=2 ITER=2 ./run-arms.sh

# 5b. continue a sweep whose driver was interrupted (skips recorded runs)
RESUME=1 START_ITER=2 ITER=2 ./run-arms.sh

# 6. tabulate
node analyze.mjs
```

`run-arms.sh` runs **one task per CLI invocation** and appends a line per run to
`results/manifest.jsonl`, naming the report the run produced and its attempt
number. `analyze.mjs` reads exactly those reports, so analysis never re-runs
inference. Use `ITER=3` for a variance estimate; report counts scale linearly in
wall-clock time.

Each invocation is preceded by `POST /foreman/providers/external:opencode/health/reset`,
which clears the router's health record for the CLI. Without it the provider
circuit — which opens on >50% errors in a 30-minute window and then *skips* runs
before the CLI starts — silently turns the rest of an arm into instant failures.
A run that is skipped anyway is retried up to three times rather than counted.

## Infrastructure notes

The first sweep of this experiment returned 1/10, 0/10, 0/10 and had to be
discarded (kept under `results/reports/invalid-circuit-open/`). Three separate
infrastructure faults were behind it, all now fixed in the harness:

1. **`PWD` versus the process cwd.** OpenCode v2 resolves its project from the
   `PWD` environment variable, and `spawn(..., { cwd })` leaves `PWD` at the
   parent's value. Every `opencode run` launched by an API server started in
   `apps/server` explored `apps/server` instead of the task checkout: 52k
   tokens, 25 shell calls, no patch. Fixed in `packages/agent/src/spawn-env.ts`
   (applied to the standard, PTY and Codex spawn paths), with a regression test
   that has to use a node-shebang fixture — `/bin/sh` rewrites `PWD` before a
   shell-script body runs, which is why the existing shell fixtures never
   caught it.

2. **Abort detection calibrated on an older stream shape.** `opencodeRunLooksAborted`
   required the stream to end with `step_finish` reason `stop`, which OpenCode
   1.x emitted. 2.x ends a healthy run with the assistant's final `text` part
   and no trailing `step_finish` at all (captured live: `step_start, tool_use,
   step_finish(tool-calls), step_start, text`), so *every* successful run was
   recorded as "stream aborted". Since `passed = success && hasPatch`, correct
   patches were failed, and each one counted against the CLI's health.

3. **The provider circuit.** With those failures inside its window, the breaker
   opened and skipped the remaining runs before the CLI started. The harness now
   exposes `POST /foreman/providers/:name/health/reset` (samples and circuit),
   and the sweep calls it before every task.

Runs are therefore classified before they are counted: `skipped` (the circuit got
there first) and `infra` (rate limit, quota, timeout) are excluded from the pass
rates and printed separately at the end of the analysis.

## What the result can and cannot show

- **Can show:** whether added context moves the pass rate on this suite, per
  task, at the stated iteration count; how the arms differ in tokens and wall
  clock; and whether the `kg` arm helps exactly where sibling material exists
  (see per-task coverage in `manifest.json`).
- **Cannot show:** generalisation. These are ten small, tightly specified
  single-file repairs whose descriptions already state the required behaviour,
  so the headroom is limited and a strong model may be near the ceiling before
  any injection. The `kg` arm also has thin coverage for the classes with no
  siblings in the corpus. Treat a positive result as a prompt for a larger,
  harder suite — not as evidence that injection helps in general.

## Results (60 runs, 2026-10-16)

Ten tasks × three arms × two iterations of `opencode/deepseek-v4.1-flash-free`,
one task per CLI invocation. 59 runs completed; the sixtieth is a CLI crash
(below) and is excluded rather than scored.

| arm | solved / runs | mean tokens | mean wall clock | mean turns |
| --- | --- | --- | --- | --- |
| baseline | 19/19 | 9.0k | 21s | 4.8 |
| skills | 20/20 | 8.8k | 18s | 4.5 |
| kg | 20/20 | 9.7k | 23s | 4.9 |

Iteration by iteration the arms are indistinguishable: iteration 1 is 10/10 for
all three, iteration 2 is 9/9, 10/10 and 10/10. No task moved between arms.

**The pass-rate result is a ceiling.** Ten small, tightly specified single-file
repairs whose descriptions already state the required behaviour leave no
headroom to separate arms that all pass, which is what this experiment set out
to find but cannot settle. What the sweep does show is the cost side, and even
that is weak: the prior-art graph is the dearest arm (mean 9.7k tokens per run,
driven by one `config-merger` run at 26.2k — nearly double any other run), the
curated procedure is the cheapest and quickest, and both differences are small
next to the spread inside an arm (7.1k–26.2k tokens, 3–7 turns, 10–46s).

Two events from this sweep are worth recording, both about infrastructure
rather than the model:

- One baseline run (iteration 2, `retry-backoff`) was lost when the `opencode`
  CLI crashed on its own session store —
  `{"type":"error","error":{"message":"Failed to execute statement"}}`, exit
  code 1 — before the model produced a patch. `analyze.mjs` counts that shape
  as infrastructure; scoring it as a model failure would have put a 95% on an
  arm that in fact never had the chance to fail.
- The sweep's driver died twice with its parent process, mid-iteration, which is
  why `RESUME=1` exists: it continues from the manifest instead of repeating
  completed runs.

## Publishing to the lab site

`scripts/gen-harness-eval.mjs` in benebsworth.com reads *every*
`model-eval-*.json` in `~/.omega/reports` and merges it into the site's
accumulated `results.json`. Two of its properties decide what gets published:

- A model the site has not seen before is appended **without** per-task dedupe,
  so two iterations of the same suite/task publish as two records — the model
  page would then report 20 tasks for a suite that has 10.
- A later build re-reads whatever is still in the reports directory, and merges
  by `suite|task`. Leftover duplicates for a model that is since in the baseline
  collapse, and the shrink guard refuses to write the file at all.

So exactly one run per task is published: **iteration 1 of the baseline arm**,
the pre-registered sweep. Later iterations and both treatment arms are archived
under `results/reports/not-ingested/` as evidence. Ingest:

```bash
node archive-reports.mjs          # dry run: what stays, what moves
node archive-reports.mjs --apply
node ~/projects/benebsworth.com/scripts/gen-harness-eval.mjs
```

## Files

| path | role |
| --- | --- |
| `sources/skills.json` | curated procedures, class map and sibling mapping |
| `build-context.mjs` | renders `skills/` and `kg/` from the corpus, enforces the integrity rules |
| `skills/`, `kg/` | generated per-task context blocks (committed for reproducibility) |
| `manifest.json` | per-task coverage, sizes and leakage status |
| `run-arms.sh` | runs the sweep: one task per invocation, circuit cleared first, every attempt written to `results/manifest.jsonl`; `START_ITER`/`ITER` set the iteration range and `RESUME=1` continues an interrupted sweep |
| `analyze.mjs` | aggregates the manifest's reports into `results/summary.json`, per arm and per iteration |
| `archive-reports.mjs` | moves the reports the site should *not* ingest out of `~/.omega/reports` (dry run by default) |
| `results/manifest.jsonl` | one line per run: arm, iteration, task, attempt, report path |
| `results/logs/` | CLI output for every run attempt |
| `results/reports/` | archived reports: `invalid-circuit-open/` (the discarded sweep) and `not-ingested/` (debug runs kept out of the site's ingestion) |
| `results/summary.json` | machine-readable analysis output |
