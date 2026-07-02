# Omega Harness

[![Release](https://img.shields.io/github/v/release/castlemilk/harness)](https://github.com/castlemilk/harness/releases/latest)

A local-first, model-agnostic harness for scheduling work across projects, routing tasks to the right model by capability, and managing everything through a sidepanel web UI or a CLI.

## Features

- **Projects** – register directories/repos and schedule work across them.
- **Tasks / TODOs** – create tasks, assign complexity and tags, run them through the router.
- **Intelligence routing** – capability-based router picks the best model/provider for each task.
- **Pluggable providers** – OpenAI, Anthropic, Ollama, Gemini, and any OpenAI-compatible endpoint (glm, kimi, etc.).
- **Web UI** – project sidebar, task board, provider settings, and routing preview sidepanel.
- **CLI** – `harness` command for projects, tasks, UI, and skill artifact generation.
- **Skill artifacts** – point the CLI at a `SKILL.md` to generate a harness-compatible TypeScript adapter.

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
```

## Install from source

Requirements: Node.js >=20, pnpm.

```bash
git clone https://github.com/castlemilk/harness.git
cd harness
pnpm install
pnpm db:migrate
pnpm db:seed
```

`pnpm install` will also build all workspace packages so the CLI and server are ready to run.

Or download the latest release tarball from https://github.com/castlemilk/harness/releases/latest and run the same commands inside the extracted directory.

### npx install

Once published to npm, you can run the CLI without installing:

```bash
npx @flaggr/harness --help
npx @flaggr/harness ui
```

The npm package `@flaggr/harness` is built from `packages/bundle` and bundles the workspace CLI with its runtime dependencies.

## Getting started

### Run the web UI

```bash
pnpm dev
# or
./scripts/dev.sh
```

The server starts on http://localhost:4000 and the web UI opens on http://localhost:5173.

### Run the CLI

```bash
# from the repo
pnpm --filter @omega/cli exec harness --help

# or after building and linking
pnpm --filter @omega/cli build
./apps/cli/dist/index.js --help
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

# Web UI
harness ui

# Skill artifact
harness skill generate ./path/to/SKILL.md
```

## Adding providers

Use the web UI sidepanel or POST to `/providers`:

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

For OpenAI-compatible endpoints such as glm or kimi, use `kind: "generic"` and set `baseUrl`.

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

Then run:

```bash
harness skill generate ./skills/summarize/SKILL.md
```

The generated adapter is written to `packages/skills/src/generated/` and can be imported by the harness.

## Development scripts

- `pnpm dev` – start server and web UI
- `pnpm build` – build all packages
- `pnpm test` – run all tests
- `pnpm db:migrate` – apply Prisma migrations
- `pnpm db:seed` – seed default providers

## Testing

```bash
pnpm test
pnpm build
```

## License

MIT
