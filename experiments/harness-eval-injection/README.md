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

# 5. tabulate
node analyze.mjs
```

`run-arms.sh` writes one log per arm-iteration under `results/`, and
`analyze.mjs` reads the report files those logs name, so analysis never re-runs
inference. Use `ITER=3` for a variance estimate; report counts scale linearly
in wall-clock time.

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

## Files

| path | role |
| --- | --- |
| `sources/skills.json` | curated procedures, class map and sibling mapping |
| `build-context.mjs` | renders `skills/` and `kg/` from the corpus, enforces the integrity rules |
| `skills/`, `kg/` | generated per-task context blocks (committed for reproducibility) |
| `manifest.json` | per-task coverage, sizes and leakage status |
| `run-arms.sh` | runs the sweep |
| `analyze.mjs` | aggregates reports into `results/summary.json` |
| `results/` | run logs and summaries |
