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

## Architecture

```
apps/
  server/     Express API + SQLite (Prisma)
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

## Install from source

Requirements: Node.js >=20, pnpm.

```bash
git clone https://github.com/castlemilk/harness.git
cd harness
pnpm install
pnpm db:migrate
pnpm db:seed
```

`pnpm install` runs `prepare`, which generates the Prisma client and builds all workspace packages.

You can also download a release tarball from https://github.com/castlemilk/harness/releases/latest and run the same commands inside the extracted directory.

## Running the harness

### 1. Start the API server

```bash
pnpm --filter @omega/server start
```

The server runs on http://localhost:4000. It stores projects, tasks, and provider configs in a local SQLite database.

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

# Web UI only
harness ui --no-tui

# Skill artifact
harness skill generate ./path/to/SKILL.md

# Benchmarks
harness bench run                           # lightweight synthetic suite
harness bench run --suite deep-swe --path ./deep-swe/tasks --n-tasks 10
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

Reports are written to `.omega/reports/benchmark-<timestamp>.json` and `.md`. The latest report is surfaced in the web UI metrics panel.

`harness bench optimise` reads the latest report and the trace-flow of a failed task, then creates a `self-improve` task you can run to edit `packages/agent/src/prompts.ts` based on the observed failures.

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
