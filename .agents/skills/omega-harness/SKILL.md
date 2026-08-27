---
name: omega-harness
description: Process for running, validating, tracing and continuously improving the Omega harness.
---

# Omega Harness Skill

This skill defines the process for running, validating, tracing and continuously improving the Omega harness.

## What it is

Omega is a multi-project task harness. It can:

- Register projects (directories/repos).
- Schedule work across them.
- Route tasks to LLM providers based on capability (simple/medium/complex).
- Track tasks, steps, traces and diffs in an embedded PGlite database.
- Expose a web UI, a TUI console and a gRPC task-ingestion API.

## Install / run

```bash
# Run the published package from anywhere (current release: 0.6.9)
npx @castlemilk/omega ui

# Or run from source
pnpm install
pnpm dev
```

In the TUI:

- `q` / `esc` quit
- `t` collapse/expand the task list
- `s` toggle sidebar layout

## Run the E2E suite and generate a report

```bash
node scripts/run-e2e-report.mjs
```

This runs `pnpm --filter @omega/e2e test`, writes raw Vitest JSON to `$OMEGA_STORAGE_ROOT/reports/e2e-raw-<ts>.json` and a Markdown summary to `$OMEGA_STORAGE_ROOT/reports/e2e-report-<ts>.md` (default `~/.omega/reports/`).

## Run performance benchmarks

```bash
node scripts/run-benchmarks.mjs
```

This starts a temporary harness server + mock Kimi LLM, measures HTTP task creation, gRPC task submission and end-to-end task-run latency, then writes `$OMEGA_STORAGE_ROOT/reports/benchmark-<ts>.json` (default `~/.omega/reports/`).

## Process traces

Each task records:

- **Steps** — `GET /tasks/:id/steps`
- **Traces** — `GET /tasks/:id/traces` (model inputs/outputs/reasoning)
- **Diffs** — `GET /tasks/:id/diffs` (code changes made by the agent)
- **Agent run** — `GET /tasks/:id/agent-run`

When reviewing an agent task, always fetch these four endpoints and summarise:

1. What was the plan?
2. What files changed?
3. What validation was run?
4. Did it pass or fail, and why?

## Self-improvement loop

The loop submits tasks back into the harness, lets the agent improve the codebase, captures traces/diffs, validates the candidate in its own worktree, compares it with a baseline benchmark, and fast-forwards the promotion branch only when all gates pass. The complete operator guide is [docs/self-improvement-loop.md](../../../docs/self-improvement-loop.md).

### Start the harness server first

```bash
# Uses the Kimi provider from .env if KIMI_API_KEY is set
npx @castlemilk/omega ui --no-tui
```

### Run one controlled iteration

```bash
OMEGA_LOOP_MAX_ITERATIONS=1 OMEGA_LOOP_AUTO_PUBLISH=false node scripts/omega-loop.mjs
```

### Run continuously (default)

```bash
# Review the config defaults first
OMEGA_LOOP_MAX_ITERATIONS=5 \
OMEGA_LOOP_INTERVAL_MS=120000 \
OMEGA_LOOP_AUTO_PUBLISH=false \
node scripts/omega-loop.mjs
```

### Loop configuration

| Variable | Default | Purpose |
|---|---|---|
| `OMEGA_LOOP_API_URL` | `http://localhost:4000` | Harness API endpoint |
| `OMEGA_LOOP_PROJECT_ID` | (created automatically) | Project to attach tasks to |
| `OMEGA_LOOP_PROMPT` | Review codebase, run lint/e2e, implement best improvement | Task description sent to the agent |
| `OMEGA_LOOP_MAX_ITERATIONS` | `3` | Hard stop after N iterations |
| `OMEGA_LOOP_INTERVAL_MS` | `60000` | Wait time between iterations |
| `OMEGA_LOOP_AUTO_PUBLISH` | `false` | Release-policy signal only; the loop never publishes an npm package |
| `OMEGA_LOOP_VALIDATE` | `true` | Required for promotion; `false` refuses candidate promotion |
| `OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES` | `2` | Stop if this many iterations fail in a row |
| `OMEGA_LOOP_PROMOTION_BRANCH` | `main` | Branch that must remain clean and unchanged during validation |

### Outputs

- Iteration reports: `$OMEGA_STORAGE_ROOT/iterations/iteration-<n>-<ts>.md`
- Candidate gate reports: `$OMEGA_STORAGE_ROOT/candidate-gates/iteration-<n>/`
- Benchmark reports: `$OMEGA_STORAGE_ROOT/reports/benchmark-<ts>.json`

### Safety guardrails

- The loop never publishes an npm package. `OMEGA_LOOP_AUTO_PUBLISH` is retained as a release-policy signal in reports; publishing is an explicit post-promotion action.
- Candidates are validated in a detached worktree with install, benchmark dependency build, recursive build, lint, and recursive tests before promotion.
- Baseline and candidate benchmark metrics are compared with a 10% tolerance and a 100ms minimum allowance.
- Promotion requires a clean, attached promotion branch at the same base commit and uses `git merge --ff-only`.
- The loop stops after `OMEGA_LOOP_MAX_ITERATIONS`.
- The loop stops after `OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES` consecutive failures.
- The agent commits changes to a branch named `agent/<task-id>`, not directly to the current branch.
- Always review `$OMEGA_STORAGE_ROOT/iterations/`, the task traces, steps, diffs, and agent-run metadata before release.

## How the agent improves the harness

Tasks tagged with `self-improve` are routed to `packages/agent/src/executor.ts`, which:

1. Selects a provider using `packages/router`.
2. Creates a plan.
3. Uses tools (`read_file`, `write_file`, `edit_file`, `run_command`, `think`, `finish`, optionally `publish`).
4. Records every turn in `taskTrace`.
5. Captures the diff in `taskDiff`.
6. Commits to `agent/<task-id>`.

When processing a self-improvement result, follow the trace → diff → validation order from the audit rubric.
