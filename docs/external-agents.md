# External Agent Harnesses

Omega can drive external coding-agent CLIs as the executor for a task, so you
can control other harnesses (Codex, Claude Code, Gemini CLI, OpenCode, Cursor
CLI, Aider) from the same task board, traces, and benchmarks.

## How it works

A task tagged `external:<cli>` is routed to `runExternalAgentTask` instead of
the internal agent loop. The harness:

1. Builds a prompt from the task title/description plus a build/test gate.
2. Runs the external CLI in the project directory (non-interactive where the
   CLI supports it).
3. Commits any changes the agent left in the working tree.
4. Captures the git diff into a `TaskDiff`, marks the task done when a patch
   exists and the CLI succeeded, and records spans (`external.task`,
   `external.<cli>`).

Supported `cli` values and the commands used:

| Tag | CLI command | Notes |
| --- | --- | --- |
| `external:codex` | `codex exec --sandbox workspace-write --skip-git-repo-check <prompt>` | OpenAI Codex CLI. |
| `external:claude-code` | `claude -p <prompt>` | Anthropic Claude Code. |
| `external:gemini-cli` | `gemini -p <prompt>` | Google Gemini CLI. |
| `external:opencode` | `opencode run <prompt>` | OpenCode. |
| `external:cursor-cli` | `cursor-agent -p <prompt>` | Cursor CLI. |
| `external:aider` | `aider --message <prompt> --yes` | Aider (must be installed). |

The external agent uses its own configured model/account; Omega records the
CLI as the task’s provider/model.

## Usage

```bash
# Create the task with the external harness tag
harness task create --project <project-id> --title "Add a farewell util" \
  --description "Create src/farewell.js and a test" \
  --tags external:claude-code --run

# Or via the API
curl -X POST http://localhost:4000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","title":"Add a farewell util","description":"...","tags":["external:claude-code"]}'
curl -X POST http://localhost:4000/tasks/<task-id>/run
```

## Benchmarks

External agents can be benchmarked like internal models by creating tasks
tagged `external:<cli>` and running them through `omega bench` suites that
create tasks with that tag. The existing trace/diff/report pipeline applies
unchanged.

## Notes and caveats

- The external CLI must be installed and authenticated on the host. The
  harness fails the task with a clear error when the CLI is missing or exits
  non-zero.
- These CLIs run with their own permissions; `codex` is invoked with
  `--sandbox workspace-write`, but you should still treat external agents as
  having write access to the project.
- Task completion is judged by “CLI succeeded and produced a diff”. For a
  stricter gate, run the project’s build/test command in the task description
  or add a verifier step.
- Codex requires OpenAI credits; if the account is out of credits the task
  will fail with the CLI’s usage-limit error.
