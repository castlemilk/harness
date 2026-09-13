# Omega Harness

[![Release](https://img.shields.io/github/v/release/castlemilk/harness)](https://github.com/castlemilk/harness/releases/latest)
[![npm](https://img.shields.io/npm/v/@castlemilk/omega)](https://www.npmjs.com/package/@castlemilk/omega)

A local-first, model-agnostic harness for scheduling work across projects, routing tasks to the right model by capability, and managing everything through a sidepanel web UI or a CLI.

## Features

- **Projects** – register directories/repos and schedule work across them.
- **Tasks / TODOs** – create tasks, assign complexity and tags, run them through the router.
- **Intelligence routing** – capability-based router picks the best model/provider for each task.
- **Pluggable providers** – OpenAI, Anthropic, Ollama, Gemini, Kimi (Moonshot), and any OpenAI-compatible endpoint (glm, etc.).
- **Web UI** – project sidebar, task board, provider settings, and routing preview sidepanel.
- **CLI** – `harness` command for projects, tasks, UI, TUI console, and skill artifact generation.
- **TUI console** – terminal dashboard that shows tasks being picked up and routed to models in real time.
- **Skill artifacts** – point the CLI at a `SKILL.md` to generate a harness-compatible TypeScript adapter.
- **Trace flow** – per-task OpenTelemetry-style spans for planning, provider calls, tool execution, and validation, visible in the UI and API.
- **Benchmarks** – run lightweight synthetic suites or load DeepSWE tasks to measure pass-rate, runtime, and span counts.
- **Trace-driven prompts** – the agent injects recent failure patterns from trace data into its system prompt to avoid repeating mistakes.
- **API-surface verification** – tasks that describe public API requirements are blocked from finishing until a concrete import/call check passes.
- **Git worktree isolation** – server-side agent runs execute inside `.omega/worktrees/<project>-<task>/` so the main repo is never polluted.
- **Prompt-version benchmarking** – every agent run is tagged with the prompt version/hash; the web UI compares pass rates across versions.
- **Token usage tracking** – provider responses record prompt/completion/total tokens and store them on each `AgentRun`.
- **Multi-agent orchestration** – tasks tagged `orchestrate` are decomposed by a high-tier planner model, implemented by smaller-model sub-agents, and closed by a review/feedback loop. See [docs/orchestration.md](docs/orchestration.md), the [roadmap](docs/roadmap.md), and the [reference corpus](docs/references.md).
- **Ledger orchestration** – tasks tagged `ledger` run a training-free manager–worker scaffold over a shared filesystem ledger (plan/notes/tasks/solution) with fresh-context short calls, output caps, truncation handling and sample-test veto. See [docs/ledger-orchestration.md](docs/ledger-orchestration.md).
- **External agent harnesses** – control Codex, Claude Code, Gemini CLI, OpenCode, Cursor CLI, or Aider by tagging a task `external:<cli>`. See [docs/external-agents.md](docs/external-agents.md).
- **Self-improvement loop** – run isolated candidate iterations with trace/diff reflection, build/lint/test validation, benchmark regression gates, and fast-forward promotion. See [docs/self-improvement-loop.md](docs/self-improvement-loop.md).
- **Agents API (`/v1`)** – versioned HTTP surface for projects, tasks, runs, traces, runtime connections and flows, with optional bearer auth (`OMEGA_API_TOKEN`).
- **MCP server** – `harness mcp` (stdio) and `POST /mcp` (Streamable HTTP) expose project/task/run management and cuttlefish runtime tools to MCP clients.
- **Cuttlefish workflow execution** – translate tasks into `cuttlefish.dev/v1alpha1` workflows, dispatch runs across the compute fleet, and mirror run status, logs, artifacts and node attempts back into task steps and trace spans.
- **Distributed tracing + hotspots** – OTel spans for HTTP requests and flow dispatch join cuttlefish's spans in Tempo; a spanmetrics pipeline feeds Mimir for p95/p99 hotspot ranking, queryable from the API, MCP and web UI. See [docs/observability.md](docs/observability.md).

## Architecture

```
apps/
  server/     Express API + PGlite (embedded Postgres, Prisma)
  web/        React + Vite + Tailwind UI
  cli/        harness CLI
packages/
  core/       shared TypeScript types
  db/         Prisma schema & client
  providers/  OpenAI, Anthropic, Ollama, Gemini, generic adapters
  router/     capability-based intelligence router
  skills/     SKILL.md parser & adapter generator
  agent/      autonomous agent executor with tracing
  bench/      benchmark runner, synthetic suite, DeepSWE adapter
  cuttlefish/ typed client + task→workflow translator for cuttlefish
  mcp/        MCP server (stdio + Streamable HTTP) over the harness API
  bundle/     npm-publishable CLI package (@castlemilk/omega)
```

## Quick start (npx)

The fastest way to run the harness CLI is via npm:

```bash
npx @castlemilk/omega --help
npx @castlemilk/omega ui
```

This starts the API server on http://localhost:4000, opens the web UI in your default browser, **and launches the TUI console in your terminal** so you can watch the LLM pick up jobs as they run.

When you run `npx @castlemilk/omega ui` inside a repo, it automatically adds the current directory as a project. If a server is already running on `:4000`, the CLI reuses it instead of starting a second one.

To open only the web UI (no terminal console):

```bash
npx @castlemilk/omega ui --no-tui
```

> The npm package name is `@castlemilk/omega`, but the command it installs is `harness`.

## Docker (local stack)

Run the harness API + web UI as a Docker container. Workflow execution expects
a cuttlefish control plane running separately (in its own Docker stack):

```bash
# 1. cuttlefish (from its repo)
(cd ~/projects/cuttlefish && make up)

# 2. harness
docker compose up -d --build     # http://localhost:4000 (API + web UI)
docker compose logs -f harness
docker compose down              # stop, keep PGlite data
docker compose down -v           # stop and wipe PGlite data
```

Inside the container the harness reaches cuttlefish through
`host.docker.internal:4444` (configured in `docker-compose.yml`). When running
the harness natively, set `RUNTIME_BASE_URL=http://localhost:4444` instead.

One-command validation — publishes `deploy/cuttlefish/hello-world.yaml` through
the harness API, runs a task tagged `flow:hello-world`, then asserts the
cuttlefish run succeeded and its logs contain the hello-world marker:

```bash
scripts/e2e/docker-e2e.sh        # build, test, tear down
KEEP=1 scripts/e2e/docker-e2e.sh # leave the stack running
task cuttlefish:e2e              # same via task
```

With tracing enabled (`CUTTLEFISH_OTEL=1`, the default) the same run also
asserts a single distributed trace across `omega-harness` and
`cuttlefish-controlplane` in Tempo, and that spanmetrics reached Mimir for
hotspot queries. Full topology and troubleshooting: [docs/docker-e2e.md](docs/docker-e2e.md);
the trace/metrics pipeline and query API: [docs/observability.md](docs/observability.md).

### Multi-agent orchestration

Run a task through the high-tier planner + smaller sub-agent orchestrator:

```bash
harness task create --project <project-id> --title "Add a greet util and test" \
  --description "Create src/greet.js and a test" --orchestrate \
  --max-subtasks 3 --max-iterations 2 --concurrency 1 --run

# or on an existing task
harness task orchestrate <task-id> --max-subtasks 3 --max-iterations 2
```

The task detail in the web UI shows sub-agents (model/status/diff) and the orchestrator trace.

### Benchmarks and model evals

Run a quick eval suite across multiple models and compare pass rate, duration, and tokens:

```bash
harness bench eval --suite deep \
  --models "kimi/moonshot-v1-128k,kimi/moonshot-v1-32k,kimi/moonshot-v1-8k"

# deeper 10-task suite, or subsets
harness bench eval --suite deep --task-id deep-lru-cache --task-id deep-debug-off-by-one \
  --models "kimi/moonshot-v1-32k,kimi/moonshot-v1-8k"

# external coding-agent harnesses (Codex, Claude Code, Gemini CLI, OpenCode, Cursor CLI, Aider)
harness bench eval --suite deep \
  --harnesses "claude-code,opencode" --task-id deep-lru-cache --task-id deep-debug-off-by-one
```

Reports are written to `~/.omega/reports/model-eval-*.json` (and `.md`).

### DeepSWE benchmarking

Long-horizon tasks from real open-source repositories with Docker-isolated
program-based verifiers, a golden grading-replay corpus, and flake-aware
scoring. The task corpus ships as a pinned submodule. Fresh-machine runbook:
[docs/DEEPSWE-QUICKSTART.md](docs/DEEPSWE-QUICKSTART.md); methodology and
scoring history: [docs/DEEPSWE-SCORING-PLAN.md](docs/DEEPSWE-SCORING-PLAN.md).

```bash
git clone --recursive https://github.com/castlemilk/harness.git
task setup && task deep-swe:golden   # verifier-only, no model spend
```

## Install from source

Requirements: Node.js >=20, pnpm.

```bash
git clone --recursive https://github.com/castlemilk/harness.git
cd harness
pnpm install
pnpm db:migrate
pnpm db:seed
```

`pnpm install` runs a small `postinstall` fix-up for `node-pty`; generate the Prisma client and migrate with `pnpm db:generate && pnpm db:migrate` (or `task setup`, which does all of it).

You can also download a release tarball from https://github.com/castlemilk/harness/releases/latest and run the same commands inside the extracted directory.

## Running the harness

### 1. Start the API server

```bash
pnpm --filter @omega/server start
```

The server runs on http://localhost:4000. It stores projects, tasks, and provider configs in a local PGlite database (embedded Postgres) under `pglite-data/`.

### 2. Start the web UI

In another terminal:

```bash
pnpm --filter @omega/web dev
```

Open http://localhost:5173.

Or start both together:

```bash
pnpm dev
# or
./scripts/dev.sh
```

### 3. Use the CLI

From the repo:

```bash
pnpm --filter @omega/cli exec harness --help
pnpm --filter @omega/cli exec harness console
```

From npm:

```bash
npx @castlemilk/omega --help
npx @castlemilk/omega console
```

## CLI usage

```bash
# Projects
harness project add --name my-project --path /path/to/project
harness project list

# Tasks
harness task create --project <id> --title "Summarize README" --complexity simple
harness task list --project <id>
harness task run <id>

# Feed tasks via gRPC (auto-runs through the router)
harness task feed --project <id> --title "Summarize README" --complexity simple --auto-run

# Web UI + TUI console
harness ui

# TUI console only
harness console

# MCP server over stdio (for Claude Code, Codex, Cursor, ...)
harness mcp

# Web UI only
harness ui --no-tui

# Skill artifact
harness skill generate ./path/to/SKILL.md

# Benchmarks
harness bench run                           # lightweight synthetic suite
harness bench run --suite deep-swe --path ./deep-swe/tasks --n-tasks 10 --provider kimi --model kimi-k2
harness bench optimise                      # create self-improve task from latest report

# Trace flow (per-task spans)
# Open a task in the web UI and click the "Trace flow" tab, or use:
harness agent traces <task-id>
```

## Configuration

Copy `.env.example` to `.env` and fill in any cloud provider API keys you want to use:

```bash
cp .env.example .env
```

The harness reads provider API keys from the database (`ProviderConfig` rows), so you can also add providers through the web UI or API without `.env`.

### Default local provider

`pnpm db:seed` creates a default Ollama provider pointing at http://localhost:11434. Make sure Ollama is running and has a model like `llama3` available, or add another provider.

## Adding providers

### Web UI

Open the right-hand sidepanel, click **+ Add** under Providers, and enter the provider details.

### API

```bash
curl -X POST http://localhost:4000/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "openai",
    "kind": "openai",
    "apiKey": "sk-...",
    "defaultModel": "gpt-4o",
    "capabilities": [{"name":"gpt-4o","level":"advanced","supportsVision":true,"supportsTools":true}]
  }'
```

For Kimi, use `kind: "kimi"`. For other OpenAI-compatible endpoints such as glm, use `kind: "generic"` and set `baseUrl`.

## gRPC task ingestion

The harness exposes a gRPC service (`TaskIngestion`) on port `50051` (configurable via `GRPC_PORT`). You can submit tasks programmatically and they will appear in the web UI/TUI and be scheduled by the router.

```bash
# Start the harness
npx @castlemilk/omega ui

# In another terminal, feed a task
npx @castlemilk/omega task feed \
  --project <project-id> \
  --title "Summarize the README" \
  --complexity simple \
  --auto-run
```

Without `--auto-run`, the task is created with status `todo` and can be run later from the UI or CLI. With `--auto-run`, the router picks a provider immediately and executes the task.

The gRPC proto is defined in `proto/tasks.proto`.

## Agents API (`/v1`)

The versioned API is the stable surface for external clients and MCP. It mirrors the existing routes (projects, tasks, providers, router, traces) and adds runtime connections and flows.

```bash
# Capabilities + health
curl http://localhost:4000/v1
curl http://localhost:4000/v1/health

# Register a cuttlefish control plane
curl -X POST http://localhost:4000/v1/runtimes \
  -H 'Content-Type: application/json' \
  -d '{"name":"local-cuttlefish","baseUrl":"http://localhost:4444","autoRoute":false}'

# Create + run a task through the runtime (tag selects the connection)
curl -X POST http://localhost:4000/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","title":"Add a greet util","tags":["runtime:local-cuttlefish"]}'
curl -X POST http://localhost:4000/v1/tasks/<id>/run

# Inspect runs and flows
curl http://localhost:4000/v1/runs
curl "http://localhost:4000/v1/flows?taskId=<id>"
curl http://localhost:4000/v1/flows/<flow-id>/logs
```

Set `OMEGA_API_TOKEN` to require `Authorization: Bearer <token>` (or `x-omega-token`) on `/v1` and `/mcp`. `/v1/health` stays open for liveness probes.

## MCP server

The harness exposes the same API as an MCP server: stdio for local agent hosts, Streamable HTTP on the server itself.

```jsonc
// .mcp.json (this repo)
{
  "mcpServers": {
    "omega-harness": {
      "command": "node",
      "args": ["apps/cli/dist/index.js", "mcp"],
      "env": { "OMEGA_API_URL": "http://127.0.0.1:4000" }
    }
  }
}
```

```bash
pnpm --filter @omega/cli build
node apps/cli/dist/index.js mcp                  # stdio
curl -X POST http://localhost:4000/mcp ...       # Streamable HTTP
```

Tools are namespaced `omega_*`: project/task CRUD and execution, run/trace lookup, provider/router preview, `omega_runtime_*` for cuttlefish connections and `omega_flow_*` for dispatched runs.

## Cuttlefish workflow execution

`packages/cuttlefish` translates a harness task into a `cuttlefish.dev/v1alpha1` workflow and dispatches it to a fleet. Tasks opt in with tags:

| Tag | Effect |
| --- | --- |
| `runtime:<connection-name>` | Use a named runtime connection (project-scoped or global). |
| `flow:<workflow-name-or-id>` | Run that workflow from its latest published version. |
| `flow-version:<version-id>` | Pin a published workflow version. |
| `flow-off` | Disable routing even when the connection has `autoRoute`. |

Connections with `autoRoute: true` take over tasks that carry no flow tags. Workflow generation modes, in priority order:

1. `workflowTemplate` on the connection — a YAML template with `{{task.id}}`, `{{project.name}}`, … placeholders.
2. `nodeImage` + `nodeCommand` — a single inline node running the command in the image.
3. A default smoke workflow (`examples/echo` → `examples/write-file`) useful for verifying the wiring.

While a run executes, the harness mirrors cuttlefish state into the task: one `TaskStep` per node, one `TraceSpan` per attempt (with timings and outputs), and terminal status, logs and artifact names into the task result. `POST /tasks/:id/cancel` cancels the remote run; the sync loop is bounded by `OMEGA_FLOW_TIMEOUT_MS`.

Workflows are managed through the harness too — `POST /v1/runtimes/:id/workflows` validates, creates-or-updates and publishes a workflow. `deploy/cuttlefish/hello-world.yaml` is a minimal inline-node workflow used by the Docker e2e:

```bash
curl -X POST http://localhost:4000/v1/runtimes/<runtime-id>/workflows \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json; print(json.dumps({"name":"hello-world","workflowYAML":open("deploy/cuttlefish/hello-world.yaml").read()}))')"
```


## Adding skills

Create a `SKILL.md` with YAML frontmatter:

```md
---
name: summarize
description: Summarize text
args:
  - name: text
    type: string
    required: true
---
Summarize the following text concisely.
```

Then generate the adapter:

```bash
harness skill generate ./skills/summarize/SKILL.md
```

The generated TypeScript adapter is written to `packages/skills/src/generated/` (or `./harness-skills/` when running from npm) and can be imported by the harness.

## Benchmarks

The harness can evaluate itself against lightweight synthetic tasks or against DeepSWE task descriptions.

```bash
# Synthetic suite (no external dependencies)
harness bench run

# DeepSWE subset (requires cloning https://github.com/datacurve-ai/deep-swe)
git clone https://github.com/datacurve-ai/deep-swe.git
harness bench run --suite deep-swe --path ./deep-swe/tasks --n-tasks 10 --sample-seed 0
```

Reports are written to `${OMEGA_STORAGE_ROOT:-~/.omega}/reports/benchmark-<timestamp>.json` and `.md`. The latest report is surfaced in the web UI metrics panel.

`harness bench optimise` reads the latest report and the trace-flow of a failed task, then creates a `self-improve` task you can run to edit `packages/agent/src/prompts.ts` based on the observed failures.

## API-surface verification

Tasks that mention public API requirements (e.g., "expose `logic.selectorHealth()`") automatically trigger a verification step before the agent can finish. The agent uses the `verify_api_surface` tool to run concrete import/call checks against the package entry point. If the check fails, the agent must fix the missing API before finishing.

## Git worktree isolation

Server-side agent runs are executed inside a dedicated git worktree at `${OMEGA_STORAGE_ROOT:-~/.omega}/work/worktrees/<project>-<task>/`. The worktree is created from the project's current commit, the agent makes changes there, and the worktree is removed after the run. This keeps the main working directory clean and allows multiple agent tasks to run without interfering with each other. If worktree creation fails, the runner falls back to the previous in-repo branch behavior.

## Trace-driven prompts

Before each agent run, the harness queries recent `AgentRun`s and `TraceSpan`s for the project and appends a compact context block to the system prompt. This gives the model up-to-date information about:

- The most common failing validation step (lint/test/build).
- Tool error rates and average durations.
- Recent `edit_file` misses.

The context is also surfaced as a `promptContextUsed` attribute on the root `agent.task` span.

## Development scripts

- `pnpm dev` – start server and web UI
- `pnpm build` – build all packages
- `pnpm test` – run all tests
- `pnpm lint` – run ESLint 9 + TypeScript across the monorepo
- `pnpm lint:fix` – auto-fix ESLint issues
- `pnpm db:migrate` – apply Prisma migrations
- `pnpm db:seed` – seed default providers

## TUI console

The `harness console` command opens a live terminal dashboard that polls the harness API and shows:

- Tasks queued from the web UI or CLI
- Which provider/model picked up each job
- Status changes (todo → in_progress → done/failed)
- A scrolling console log of routing events
- Aggregated stats across all tasks

It is also launched automatically when running `harness ui`. Press `q` or `Esc` to close the console, `t` to collapse/expand the task list, and `s` to switch between stacked and sidebar layouts.

## Releasing

Pushing a `v*` tag publishes `@castlemilk/omega` to npm and creates a GitHub release:

```bash
git tag -a v0.1.6 -m "next release"
git push origin v0.1.6
```

The `NPM_TOKEN` secret must be set at https://github.com/castlemilk/harness/settings/secrets/actions.

## Testing

```bash
pnpm test
pnpm build
```

## License

MIT
