# Self-Improvement Loop

The self-improvement loop lets Omega propose and implement changes to the
harness while keeping the current promotion branch protected. It is an
experiment runner, not an unattended release pipeline: every iteration must
produce inspectable artifacts, pass the candidate gate, and remain fast-forward
compatible with the branch being promoted.

## Operating Model

One iteration follows this sequence:

1. Submit a task tagged `self-improve` to the harness.
2. Run the task through the normal agent executor. The executor works on
   `agent/<task-id>` and records the plan, tool steps, traces, diff, and agent
   run metadata.
3. Fetch the task artifacts from the API.
4. Run the baseline benchmark from the current promotion checkout.
5. Create a detached validation worktree at the candidate commit.
6. Install dependencies and run candidate build, lint, and test commands in
   that worktree.
7. Run the same benchmark against the candidate worktree.
8. Reject the candidate if a required status, benchmark metric, repository
   invariant, or branch invariant fails.
9. Fast-forward the promotion branch to the candidate only after every gate
   passes.
10. Write a Markdown iteration report, whether the candidate passed or failed.

The implementation is in:

| Component | File | Responsibility |
|---|---|---|
| Loop | `scripts/omega-loop.mjs` | Submit tasks, collect artifacts, invoke the gate, write reports. |
| Candidate gate | `scripts/self-improve-gates.mjs` | Validate, benchmark, compare, and promote candidates. |
| Gate tests | `scripts/self-improve-gates.test.mjs` | Test benchmark acceptance/rejection and candidate promotion. |
| Benchmark | `scripts/run-benchmarks.mjs` | Run the repeatable HTTP/gRPC mock-provider benchmark. |
| Agent executor | `packages/agent/src/executor.ts` | Create isolated agent branches and persist run metadata. |

## Start Safely

Build the source tree and start the API server first:

```bash
pnpm install
pnpm -r build
pnpm --filter @omega/server start
```

Run one iteration before enabling a longer run:

```bash
OMEGA_LOOP_MAX_ITERATIONS=1 \
OMEGA_LOOP_PROVIDER=ollama-local \
OMEGA_LOOP_MODEL=qwen3:8b \
OMEGA_LOOP_TOKEN_BUDGET=30000 \
OMEGA_LOOP_AUTO_PUBLISH=false \
node scripts/omega-loop.mjs
```

For controlled iteration batches:

```bash
OMEGA_LOOP_MAX_ITERATIONS=5 \
OMEGA_LOOP_INTERVAL_MS=120000 \
OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES=2 \
OMEGA_LOOP_AUTO_PUBLISH=false \
node scripts/omega-loop.mjs
```

Do not set `OMEGA_LOOP_VALIDATE=false` for a promotion run. That setting
deliberately refuses promotion; it is useful only for diagnosing task and
artifact collection.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `OMEGA_LOOP_API_URL` | `http://localhost:4000` | Harness API endpoint. |
| `OMEGA_LOOP_PROJECT_ID` | unset | Existing project ID. If unset, the loop finds or creates a project by path. |
| `OMEGA_LOOP_PROJECT_PATH` | repository root | Repository under improvement. |
| `OMEGA_LOOP_PROJECT_NAME` | `omega-harness` | Name used when creating the project. |
| `OMEGA_LOOP_PROMPT` | built-in review prompt | Task description given to the agent. |
| `OMEGA_LOOP_MAX_ITERATIONS` | `3` | Hard limit for one process. |
| `OMEGA_LOOP_INTERVAL_MS` | `60000` | Delay between iterations. |
| `OMEGA_LOOP_TASK_TIMEOUT_MS` | `1800000` | Timeout for agent and candidate commands. |
| `OMEGA_LOOP_PROVIDER` | unset | Provider to pin for each self-improvement task. Set with `OMEGA_LOOP_MODEL`. |
| `OMEGA_LOOP_MODEL` | unset | Model to pin for each self-improvement task. Set with `OMEGA_LOOP_PROVIDER`. |
| `OMEGA_LOOP_TOKEN_BUDGET` | unset | Token cap forwarded to each task run. |
| `OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES` | `2` | Stop threshold for failed tasks or gates. |
| `OMEGA_LOOP_VALIDATE` | `true` | Required switch for candidate validation and promotion. `false` refuses promotion. |
| `OMEGA_LOOP_PROMOTION_BRANCH` | `main` | Branch whose unchanged base is required for promotion. |
| `OMEGA_LOOP_AUTO_PUBLISH` | `false` | Kept as a release-policy signal in reports. The loop does not publish npm packages. |
| `OMEGA_STORAGE_ROOT` | `~/.omega` | Iteration reports, benchmark reports, and temporary candidate-gate data. |

The loop does not add the `publish` tag. Publishing must be a separate,
explicit post-promotion action after a human reviews the candidate report and
diff. This prevents a successful benchmark from silently becoming an npm
release.

## Gate Contract

The gate rejects a candidate before promotion when any of these conditions is
true:

- The task or agent run did not finish with status `done`.
- The recorded branch, base commit, or diff is missing.
- The candidate branch does not exist or has no change over its base commit.
- The promotion checkout is dirty, detached, on the wrong branch, or has
  changed since validation started.
- The baseline benchmark cannot produce a report.
- Candidate dependency installation, benchmark build, workspace build, lint,
  or recursive tests fail.
- Candidate HTTP or gRPC task status is not `done`.
- A required candidate latency metric is missing or exceeds the baseline by
  more than 10%, with a minimum 100ms allowance.
- The final `git merge --ff-only` cannot promote the candidate.

The benchmark currently compares:

- `httpCreateTaskMs`
- `taskRunTotalMs`
- `grpcSubmitTaskMs`
- `grpcTaskRunTotalMs`

The baseline and candidate reports are stored under the configured storage
root (default `~/.omega`):

```text
$OMEGA_STORAGE_ROOT/candidate-gates/iteration-<n>/
  baseline/reports/benchmark-*.json
  candidate/reports/benchmark-*.json
```

The candidate worktree is removed in a `finally` block after validation. The
agent branch remains available for audit and can be deleted separately after
the report and commit have been reviewed.

## Hooks And Checkpoints

There is no plugin callback API for the loop yet. The reliable hook points are
the existing agent tools, task endpoints, scripts, and persisted artifacts.

### Agent-side hooks

Use these in the agent's plan and before `finish`:

1. `think`: state the hypothesis, expected behavior, and smallest safe change.
2. `read_file` / search: inspect the implementation and existing tests before
   editing.
3. `write_file` / `edit_file`: make the smallest source change.
4. `run_command`: run a focused test immediately after the change, then the
   project build and full existing test command.
5. `validate_patch`: confirm the diff is clean and applies against the base.
6. `verify_api_surface`: required for tasks that add or change public API.
7. `finish`: report files changed, commands run, results, and remaining risk.

The executor also invokes reflection when the trace is stuck or the task is
approaching its step budget. Reflection should produce an action, not a new
research branch: reduce scope, run the focused failure, fix it, or finish with
a disclosed failure.

### Harness-side hooks

Review or instrument these checkpoints when extending the loop:

| Checkpoint | Artifact or command | Question |
|---|---|---|
| Task submitted | `POST /tasks`, task tags | Was this clearly an improvement experiment? |
| Agent completed | `GET /tasks/:id/agent-run` | Which branch and base commit were produced? |
| Plan and reflection | `GET /tasks/:id/traces` | Did the agent follow a useful hypothesis and recover from failures? |
| Tool execution | `GET /tasks/:id/steps` | Were focused validation and required API checks actually run? |
| Candidate change | `GET /tasks/:id/diffs` | Does the patch match the claimed improvement and stay scoped? |
| Validation | `self-improve-gates.mjs` | Did the candidate pass build, lint, tests, and benchmarks in its own worktree? |
| Promotion | `git merge --ff-only` | Did the promotion branch remain unchanged and clean? |
| Iteration close | `.omega/iterations/*.md` | Can another operator understand why this iteration passed or failed? |

## Reflection Protocol

Reflection is the feedback loop that turns one-off agent activity into harness
improvement. For every iteration, review the artifacts in this order:

1. **Trace:** identify the initial hypothesis, the first failure, retries, and
   the point where the agent decided it was done.
2. **Diff:** compare the actual patch with the task description. Watch for
   unrelated edits, generated files, test weakening, and changes that only
   satisfy the benchmark fixture.
3. **Steps:** confirm focused tests ran before broad validation and that a
   failed command was fixed rather than ignored.
4. **Agent run:** record provider, model, branch, base commit, result status,
   and timing/token signals.
5. **Gate report:** compare each baseline/candidate metric and identify whether
   the failure was behavioral, performance-related, environmental, or an
   artifact problem.

Classify each failed iteration using one primary cause:

- `task`: the agent did not complete the requested work.
- `patch`: the diff is empty, invalid, too broad, or unrelated.
- `validation`: build, lint, tests, or API checks failed.
- `regression`: benchmark behavior or latency regressed.
- `environment`: provider, database, port, dependency, or timeout failure.
- `promotion`: the branch moved, became dirty, or could not fast-forward.

Only change prompts, skills, routing, or executor behavior when the same
failure pattern appears in multiple traces or is confirmed by a deterministic
test. A reflection that is not backed by a trace, diff, metric, or test is a
hypothesis and should not be promoted as a fix.

## Reports And Audit

The loop writes:

- `$OMEGA_STORAGE_ROOT/iterations/iteration-<n>-<timestamp>.md`: task result, agent metadata,
  diff summary, gate result, validation steps, and metric comparison.
- `$OMEGA_STORAGE_ROOT/candidate-gates/iteration-<n>/`: raw baseline and
  candidate benchmark reports.
- `$OMEGA_STORAGE_ROOT/reports/`: standalone benchmark reports when running
  `scripts/run-benchmarks.mjs` directly.

Before accepting an iteration, preserve or link the task ID, candidate commit,
iteration report, and benchmark report. These are the minimum evidence needed
to reproduce or explain a promotion.

## Keeping The Loop Healthy

Use this maintenance cadence:

- Every iteration: inspect the report and reject unexplained failures.
- Every prompt or planner change: run at least one controlled iteration and
  compare it with the previous behavior.
- Every gate change: add a deterministic unit test and one candidate-worktree
  integration test.
- Every benchmark change: run the standalone benchmark and confirm cleanup on
  both success and failure paths.
- Before a long run: verify the promotion branch is clean, the server is
  healthy, provider/model selection is pinned for repeatability, and storage
  is outside the repository when possible.
- Before release: review several successful iteration reports, inspect the
  cumulative diff, run the normal release checks, and publish explicitly.

The loop should get better by reducing repeated failure classes, not by
increasing iteration count. If the same class repeats, stop the loop, add a
regression test or a clearer guardrail, and only then resume.
