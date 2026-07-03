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
# Run the published package from anywhere (current release: 0.6.6)
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

This runs `pnpm --filter @omega/e2e test`, writes raw Vitest JSON to `.omega/reports/e2e-raw-<ts>.json` and a Markdown summary to `.omega/reports/e2e-report-<ts>.md`.

## Run performance benchmarks

```bash
node scripts/run-benchmarks.mjs
```

This starts a temporary harness server + mock Kimi LLM, measures HTTP task creation, gRPC task submission and end-to-end task-run latency, then writes `.omega/reports/benchmark-<ts>.json`.

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

The loop submits tasks back into the harness, lets the agent improve the codebase, captures traces/diffs, and validates with E2E + benchmarks.

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
| `OMEGA_LOOP_AUTO_PUBLISH` | `false` | Allow the agent to publish a new npm version |
| `OMEGA_LOOP_VALIDATE` | `true` | Run E2E report + benchmarks after each task |
| `OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES` | `2` | Stop if this many iterations fail in a row |

### Outputs

- Iteration reports: `.omega/iterations/iteration-<n>-<ts>.md`
- E2E reports: `.omega/reports/e2e-report-<ts>.md`
- Benchmark reports: `.omega/reports/benchmark-<ts>.json`

### Safety guardrails

- The loop only publishes when `OMEGA_LOOP_AUTO_PUBLISH=true` AND the task is tagged with `publish` (the loop adds the tag automatically when enabled).
- The loop stops after `OMEGA_LOOP_MAX_ITERATIONS`.
- The loop stops after `OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES` consecutive failures.
- The agent commits changes to a branch named `agent/<task-id>`, not directly to the current branch.
- Always review `.omega/iterations/` before enabling auto-publish or merging a branch.

## How the agent improves the harness

Tasks tagged with `self-improve` are routed to `packages/agent/src/executor.ts`, which:

1. Selects a provider using `packages/router`.
2. Creates a plan.
3. Uses tools (`read_file`, `write_file`, `run_command`, `think`, `finish`, optionally `publish`).
4. Records every turn in `taskTrace`.
5. Captures the diff in `taskDiff`.
6. Commits to `agent/<task-id>`.

When processing a self-improvement result, follow the trace → diff → validation order from the audit rubric.
