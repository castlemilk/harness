# Adversarial Review by qwen (qwen3.8-max-preview)

Duration: 494024ms | Tokens: 23627

---

# Omega Harness — Adversarial Security & Code-Quality Review

## Scope / location note

You provided an architecture manifest, not full source. Exact numeric line numbers are therefore not derivable without the repository mounted. I am giving the narrowest possible **file:symbol** or **file:line-range** locations based on the manifest. In a source-mounted audit, these are direct grep targets.

---

# PASS 0 — Pre-Audit Inventory

## Codebase topology

Major modules:

- `packages/core` — shared types and workspace helpers.
- `packages/router` — multiple routing implementations.
- `packages/agent` — executor, tools, orchestrator, external CLI runner.
- `packages/providers` — LLM provider adapters.
- `packages/bench` — benchmark execution and evaluation.
- `packages/db/prisma` — persistence schema.
- `apps/server` — Express API, task queue, router singleton, SSE, benchmark orchestration.
- `apps/web` — React frontend with SSE-consuming panels.

## God Modules

These are immediate red flags:

1. `packages/agent/src/executor.ts` — **2215 lines**
   - Main agent loop.
   - Retry logic.
   - Provider dispatch.
   - Tool dispatch.
   - Patch validation.
   - Checkpointing.
   - Shell-command classification.

   This is a classic God Module. It likely has high cyclomatic complexity, hidden coupling, and unsafe security boundaries.

2. `packages/router/src/intelligent.ts` — **841 lines**
   - Router.
   - Health registry.
   - Circuit breaker.
   - Performance cache.
   - Strategy learner.
   - Scoring engine.
   - Fallback cascade.
   - Persistence.

   This is not one module; it is a bundled subsystem pretending to be a file.

3. `apps/web/src/components/BenchmarkPanel.tsx` — **1440 lines**
   - UI panel.
   - SSE subscription.
   - State management.
   - Data presentation.
   - Likely error/loading/retry logic.

   A React component this large is almost guaranteed to contain state-management defects and teardown issues.

## AI-generation markers

Strong markers visible from the manifest:

- Grandiose abstraction names:
  - `IntelligentRouter`
  - `StrategyLearner`
  - `ScoringEngine`
  - `FallbackCascade`
  - `PerformanceCache`
  - `ProviderHealthRegistry`

  This is a common AI-generated pattern: many impressive nouns, unclear isolation boundaries.

- Multiple near-overlapping routing modules:
  - `intelligent.ts`
  - `rules.ts`
  - `tiers.ts`
  - `difficulty-aware.ts`

  This suggests iterative generation without consolidation.

- Self-referential bug-fix narrative:
  - `task-queue.ts — Concurrency pool (max 3), splice-skip bug fixed`

  This is a classic AI repair marker: a bug is named as “fixed” in the architecture description rather than evidenced by tests or design hardening.

- Context-boundary drift:
  - `run-task.ts — NOT in agent; in server`

  This reads like an AI correction note, not a stable architectural decision.

- Monolithic UI component generation:
  - `BenchmarkPanel.tsx` at 1440 lines.

---

# Findings

---

## 1. Missing authentication/authorization on server routes enables full system compromise

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `apps/server/src/app.ts:route registration`; `apps/server/src/routes/*.ts`
- **Category:** security

### Description

The server exposes CRUD, SSE, provider configuration, router decisions, cost analytics, error analysis, traces, benchmark runs, and task dispatch. The manifest does not mention authentication middleware, authorization middleware, RBAC, API tokens, session protection, CSRF protection, or ownership scoping.

Because the agent framework can execute tools, including `run_command`, an unauthenticated API surface is effectively an unauthenticated remote code execution surface.

### Evidence

```text
apps/server/src/
- `app.ts` — Express app, CORS, ZodError→400, global error handler
- `routes/tasks.ts` — CRUD, SSE stream, pagination...
- `routes/providers.ts` — Provider config CRUD, warmup...
- `routes/bench-runs.ts` — Benchmark run management
- `routes/router.ts` — Router decisions
- `routes/costs.ts` — Cost analytics
- `routes/errors.ts` — Error analysis
- `routes/traces.ts` — Trace timeline
```

No auth middleware is listed.

### Remediation

Add authentication and authorization before any route handler:

```ts
app.use(requireAuth);
app.use(requireProjectScope);
app.use("/api/tasks", taskRoutes);
app.use("/api/providers", requireAdmin, providerRoutes);
```

Minimum requirements:

- API token or session authentication.
- Per-project ownership checks.
- Role-based access for provider config and benchmarks.
- CSRF protection if cookie sessions are used.
- Audit logging for privileged actions.
- Rate limiting on login/token endpoints.
- SSE auth via short-lived one-time token, not cookies alone.

---

## 2. LLM-controlled `run_command` tool executes on host without visible sandboxing

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `packages/agent/src/tools.ts:run_command`
- **Category:** security

### Description

The agent has a `run_command` tool. If this executes on the host machine or in the server container without strong isolation, any LLM prompt injection, malicious benchmark input, or compromised provider response can lead to arbitrary command execution.

This is the single most dangerous primitive in the system.

### Evidence

```text
- `tools.ts` — Tool implementations (edit_file, apply_patch, run_command, etc.)
```

No sandbox, container, seccomp, namespace, chroot, capability drop, or resource-limit mechanism is described.

### Remediation

Never run model-selected commands directly on the host.

Required controls:

- Execute commands in ephemeral containers or microVMs.
- Use read-only root filesystem where possible.
- Mount only the task workspace.
- Drop all Linux capabilities.
- Disable network unless explicitly required.
- Enforce CPU, memory, PID, and disk quotas.
- Use seccomp/AppArmor.
- Run as non-root.
- Kill entire process group on timeout/abort.
- Record command argv, not raw shell strings.

If host execution is required for product reasons, treat the entire agent as untrusted and isolate the server process itself.

---

## 3. `isReadOnlyShellCommand` splitter is trivially bypassable

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `packages/agent/src/executor.ts:isReadOnlyShellCommand`
- **Category:** security

### Description

The manifest says `isReadOnlyShellCommand` splits on:

```text
| && || ;
```

This is not a shell parser. It is a string splitter. It will miss or mishandle:

- command substitution: `$(...)`
- backticks: `` `...` ``
- newlines and carriage returns
- background execution: `&`
- redirects: `>`, `>>`, `<`
- process substitution: `>(...)`, `<(...)`
- subshells: `( ... )`
- brace expansion: `{curl,evil}`
- environment assignment: `PATH=/tmp evil`
- quoted metacharacters
- shell builtins
- `xargs`
- `find -exec`
- `git -c core.pager=...`
- `python -c`
- `node -e`
- `busybox sh`
- `tee`
- `dd`
- `tar` write operations
- `cp`, `mv`, `rm`, `chmod`, `chown`
- `curl | sh` variants if the pipe is obfuscated or encoded

Any security decision based on this function is unsound.

### Evidence

```text
- `executor.ts` — ... isReadOnlyShellCommand (splits on `|&&|||;`)
```

### Remediation

Replace string splitting with a real shell command AST parser and deny-by-default policy.

Better:

```ts
import { parse } from "shell-quote";
```

But even that is not enough. The correct design is:

1. Do not pass commands through a shell.
2. Require argv arrays.
3. Allowlist exact executables.
4. Allowlist exact subcommands.
5. Reject all metacharacters.
6. Reject redirects.
7. Reject environment overrides.
8. Reject command substitution.
9. Reject unknown flags.
10. Execute in sandbox.

Example policy:

```ts
const READ_ONLY_COMMANDS = new Map([
  ["git", ["status", "diff", "log"]],
  ["ls", []],
  ["cat", []],
]);
```

Even then, `git` and `cat` can be dangerous through hooks, pager, config, and path traversal. Sandbox first.

---

## 4. `edit_file` / `apply_patch` likely allow path traversal and symlink escape

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `packages/agent/src/tools.ts:edit_file`, `packages/agent/src/tools.ts:apply_patch`
- **Category:** security

### Description

File-editing tools driven by LLM output must treat every path as hostile. If paths are not canonicalized and jailed to the workspace root, the model can write:

- `../../etc/passwd`
- `../../home/user/.ssh/authorized_keys`
- `../../app/.env`
- absolute paths
- symlinked paths inside the workspace that point outside
- git patch paths with `a/` and `b/` prefixes
- Unicode-normalized path variants
- Windows-style path separators if cross-platform

Patch application is especially dangerous because unified diffs can contain multiple file paths and creation/deletion instructions.

### Evidence

```text
- `tools.ts` — Tool implementations (edit_file, apply_patch, run_command, etc.)
```

No path jail, realpath check, symlink policy, or workspace-root enforcement is described.

### Remediation

Implement a strict path resolver:

```ts
async function resolveInsideRoot(root: string, requested: string): Promise<string> {
  if (path.isAbsolute(requested)) throw new Error("absolute path denied");

  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, requested);
  const targetReal = await fs.realpath(target).catch(() => target);

  if (!isWithin(rootReal, targetReal)) {
    throw new Error("path escape denied");
  }

  return targetReal;
}
```

Additional requirements:

- Reject absolute paths.
- Reject `..`.
- Reject symlink creation unless explicitly allowed.
- Use `realpath` after resolving.
- Validate every file in a patch.
- Normalize patch prefixes.
- Refuse patches that touch `.git`, `.env`, SSH keys, shell configs, or package manager lockfiles unless explicitly allowed.
- Use atomic writes: temp file + rename.
- Preserve permissions intentionally, not by accident.

---

## 5. External CLI runner is a likely command-injection / untrusted-binary surface

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `packages/agent/src/external.ts`
- **Category:** security

### Description

The system can run external CLIs such as `codex`, `claude-code`, etc. If task content, model output, file paths, or environment variables are interpolated into a shell command, this is direct command injection.

Even if `spawn` is used correctly, the following remain dangerous:

- user-controlled binary path
- PATH lookup hijacking
- inherited environment secrets
- untrusted CLI plugins
- CLI arguments that themselves execute code
- writing task content to world-readable temp files
- failure to kill child processes on abort

### Evidence

```text
- `external.ts` — External CLI runner (codex, claude-code, etc.), TaskDiff creation
```

### Remediation

Minimum:

```ts
spawn(binaryPath, argv, { shell: false });
```

But that is not enough.

Required:

- Absolute path to allowed binaries only.
- Do not use `shell: true`.
- Do not interpolate task text into shell strings.
- Scrub environment variables.
- Pass secrets only through short-lived temp files or fds, not argv.
- Use unique private temp directories.
- Set process group and kill group on timeout.
- Validate CLI version/hash.
- Run external CLI in sandbox.
- Record argv for audit.
- Reject unexpected exit codes and stderr patterns.

---

## 6. Benchmark evaluation executes untrusted code in a shared git repo without visible isolation

- **Severity:** Critical
- **Pass:** 3
- **File:Line:** `packages/bench/src/runner.ts:ensureGitRepo`, `packages/bench/src/runner.ts:commit/revert/eval`
- **Category:** security

### Description

Benchmark suites such as SWE-bench and DeepSWE often involve applying patches and executing repository code. That code is untrusted. If evaluation runs in a shared git repository on the host, a malicious benchmark case can:

- execute arbitrary code
- modify shared repo state
- poison later runs
- steal provider secrets from the environment
- write persistent implants
- tamper with evaluation results
- exploit git hooks
- leave uncommitted artifacts
- race with other benchmark runs

The manifest explicitly says `ensureGitRepo shared`, which is dangerous for concurrent benchmark execution.

### Evidence

```text
- `runner.ts` — Benchmark runner (ensureGitRepo shared, commit/revert/eval)
- `adapters/` — SWE-bench, DeepSWE adapters
```

### Remediation

Do not share one working tree across benchmark runs.

Use:

- ephemeral git worktrees per run
- disposable containers per benchmark case
- unique temporary directories
- read-only base snapshot
- network disabled by default
- resource limits
- non-root user
- clean process group kill
- cryptographic run artifact hashing
- automatic worktree pruning

Concurrency model:

```text
base repo (bare, read-only)
  -> temporary worktree A
  -> temporary worktree B
  -> temporary worktree C
```

Never:

```text
shared repo -> concurrent checkout/apply/commit/revert
```

---

## 7. CORS and security-header configuration is unspecified and likely unsafe

- **Severity:** High
- **Pass:** 3
- **File:Line:** `apps/server/src/app.ts:CORS`
- **Category:** security

### Description

The manifest says `app.ts` has CORS but does not specify origin restrictions. AI-generated Express apps frequently use:

```ts
app.use(cors());
```

or:

```ts
app.use(cors({ origin: "*" }));
```

If the API uses cookies or privileged browser sessions, wildcard CORS can enable cross-origin reads. Even without cookies, an unrestricted API that can trigger agent runs is dangerous.

The manifest also does not mention security headers such as:

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Strict-Transport-Security`
- `Referrer-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`

### Evidence

```text
- `app.ts` — Express app, CORS, ZodError→400, global error handler
```

### Remediation

Use an explicit allowlist:

```ts
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS.split(","),
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
```

Add headers:

```ts
app.use(helmet());
```

For SSE, avoid cookie-based auth if possible; use short-lived signed tokens.

---

## 8. SSE stream likely lacks auth, backpressure, and server-side teardown

- **Severity:** High
- **Pass:** 2
- **File:Line:** `apps/server/src/routes/tasks.ts:SSE stream`
- **Category:** async

### Description

The server exposes an SSE stream for tasks. SSE endpoints commonly suffer from:

- missing authentication because `EventSource` cannot easily set headers
- missing client-disconnect handling
- unbounded subscriber maps
- no heartbeat
- no backpressure
- broadcasting sensitive task data to unauthorized clients
- reconnect storms from frontend
- missing connection limits
- memory leaks when clients disappear

The frontend component says it has cleanup, but server-side teardown is not described.

### Evidence

```text
- `routes/tasks.ts` — CRUD, SSE stream, pagination...
- `components/BenchmarkPanel.tsx` — 1440 lines, SSE EventSource with cleanup
```

### Remediation

Server side:

```ts
req.on("close", () => {
  subscribers.delete(clientId);
});
```

Requirements:

- Authenticate SSE via one-time signed token.
- Authorize per task/project.
- Limit concurrent SSE connections per user.
- Send heartbeat every 15–30 seconds.
- Remove subscribers on `close`, `error`, and timeout.
- Use bounded queues per subscriber.
- Drop events or close slow clients.
- Do not leak prompts, diffs, provider errors, or secrets through SSE.

---

## 9. Shared benchmark git repository creates race conditions and cross-run contamination

- **Severity:** High
- **Pass:** 2
- **File:Line:** `packages/bench/src/runner.ts:ensureGitRepo`
- **Category:** async

### Description

Even ignoring sandboxing, a shared git repo used for benchmark commit/revert/eval is a concurrency hazard. Concurrent runs can:

- checkout different commits underneath each other
- apply patches to the wrong base
- revert another run’s changes
- commit artifacts from one run into another
- produce false benchmark results
- leave dirty worktrees
- cause `git index.lock` failures
- execute code from a different benchmark case

This is both a correctness and security issue.

### Evidence

```text
- `runner.ts` — Benchmark runner (ensureGitRepo shared, commit/revert/eval)
```

### Remediation

Use isolated worktrees:

```bash
git worktree add --detach /tmp/bench-run-<id> <base-commit>
```

Then clean:

```bash
git worktree remove --force /tmp/bench-run-<id>
```

Add:

- per-run lockfiles
- unique temp directories
- automatic GC/pruning
- max concurrent runs
- dirty-tree detection
- forced cleanup on crash

---

## 10. Task queue concurrency pool is fragile and shows AI repair-pattern risk

- **Severity:** High
- **Pass:** 2
- **File:Line:** `apps/server/src/lib/task-queue.ts`
- **Category:** async

### Description

The manifest explicitly mentions:

```text
splice-skip bug fixed
```

That is a red flag. A concurrency pool implemented with mutable arrays and `splice` is easy to break under async iteration. Common defects:

- skipping tasks when removing during iteration
- duplicate dispatch
- lost wakeups
- unhandled rejection inside worker
- stuck queue if a worker throws
- no persistence across restart
- no idempotency
- race between enqueue and drain
- max concurrency not respected under burst load

The phrase “bug fixed” without mention of tests or redesign suggests patch-on-patch AI development.

### Evidence

```text
- `lib/task-queue.ts` — Concurrency pool (max 3), splice-skip bug fixed
```

### Remediation

Replace hand-rolled splice queue with a proven primitive:

- `p-queue`
- `p-limit`
- BullMQ
- Postgres-backed queue
- Redis-backed queue

Required properties:

- idempotent task IDs
- retry policy
- dead-letter queue
- persistence
- drain on shutdown
- error isolation
- no mutation during iteration
- metrics for queue depth and active jobs

---

## 11. Router singleton Promise initialization/shutdown race

- **Severity:** High
- **Pass:** 2
- **File:Line:** `apps/server/src/lib/intelligent-router.ts`
- **Category:** async

### Description

A singleton with Promise-based initialization and a shutdown function is a common source of subtle races:

- request arrives while init is pending
- init rejects and the singleton caches a rejected promise forever
- shutdown called before init resolves
- router used after shutdown
- background persistence continues after shutdown
- timers/intervals not cleared
- unhandled rejection during startup
- multiple concurrent init calls
- shutdown called twice

Because routing affects provider selection, cost, and retries, this is production-critical.

### Evidence

```text
- `lib/intelligent-router.ts` — Singleton, Promise-based init, shutdownRouter()
```

### Remediation

Use an explicit state machine:

```ts
type RouterState =
  | { status: "uninitialized" }
  | { status: "initializing"; promise: Promise<Router> }
  | { status: "ready"; router: Router }
  | { status: "shutting_down"; promise: Promise<void> }
  | { status: "stopped" }
  | { status: "failed"; error: Error };
```

Requirements:

- Do not cache rejected initialization forever.
- Allow retry after failure.
- Reject new work during shutdown.
- Await in-flight work or force-close with timeout.
- Clear timers and persistence flush intervals.
- Make shutdown idempotent.

---

## 12. AbortSignal is not provably propagated to tools, subprocesses, and external CLIs

- **Severity:** High
- **Pass:** 2
- **File:Line:** `packages/agent/src/executor.ts:withProviderRetry`, `packages/agent/src/tools.ts:run_command`, `packages/agent/src/external.ts`
- **Category:** async

### Description

The manifest says `withProviderRetry` is abort-signal-aware. That only covers provider HTTP calls. It does not prove that:

- `run_command` kills child processes
- external CLI runners kill child process groups
- file-edit tools abort long writes
- benchmark evaluation aborts subprocesses
- SSE streams stop when client disconnects
- orchestrator sub-agents cancel children
- timers are cleared
- retries stop after abort

Missing teardown leads to orphan processes, resource exhaustion, and unsafe continued file modifications after cancellation.

### Evidence

```text
- `executor.ts` — Main agent loop. withProviderRetry (abort-signal-aware), sendToProvider, tool dispatch...
- `tools.ts` — Tool implementations (edit_file, apply_patch, run_command, etc.)
- `external.ts` — External CLI runner...
```

### Remediation

Every async primitive must accept and honor `AbortSignal`.

For subprocesses:

```ts
const child = spawn(cmd, args, {
  detached: true,
  signal: abortSignal,
});

abortSignal.addEventListener("abort", () => {
  if (child.pid) process.kill(-child.pid, "SIGKILL");
});
```

Also:

- use process groups
- kill children on timeout
- cancel sub-agents recursively
- stop retries after abort
- mark task state as cancelled atomically
- prevent further tool dispatch after abort

---

## 13. `publish/validate_patch/checkpointCommit` is not provably atomic

- **Severity:** High
- **Pass:** 4
- **File:Line:** `packages/agent/src/executor.ts:publish/validate_patch`, `packages/agent/src/executor.ts:checkpointCommit`
- **Category:** logic

### Description

Agent file modification flows often do something like:

1. apply patch
2. validate
3. commit checkpoint
4. continue

If any step fails partially, the workspace can be left dirty:

- patch half-applied
- index locked
- commit created but metadata not saved
- metadata saved but commit failed
- validation ran against wrong tree
- subsequent agent step inherits corrupt state
- benchmark evaluation uses stale artifacts

This is a transaction/atomicity failure.

### Evidence

```text
- `executor.ts` — ... publish/validate_patch, checkpointCommit...
```

### Remediation

Make checkpointing transactional:

- work in a temporary git worktree
- apply patch to scratch index
- validate before committing
- roll back automatically on failure
- verify `git status --porcelain` is clean
- persist run metadata and commit hash in one DB transaction
- use idempotent checkpoint IDs
- recover from crash by discarding incomplete checkpoints

Pseudo-flow:

```text
begin checkpoint
  create worktree
  apply patch
  validate
  commit
  record commit in DB
end checkpoint
on error:
  destroy worktree
  mark checkpoint failed
```

---

## 14. Provider secrets are likely stored, returned, or logged insecurely

- **Severity:** High
- **Pass:** 3
- **File:Line:** `packages/db/prisma/schema.prisma:ProviderConfig`, `apps/server/src/routes/providers.ts`
- **Category:** security

### Description

`ProviderConfig` almost certainly contains secrets: API keys, tokens, base URLs, organization IDs, billing metadata. The manifest says provider config CRUD exists, but does not mention:

- encryption at rest
- redaction on read
- write-only secret fields
- audit logging
- secret rotation
- masking in logs
- protection from SSE/error routes

If provider secrets are readable through the API, or included in error/trace logs, the system leaks credentials.

### Evidence

```text
- `schema.prisma` — Task, AgentRun, TaskDiff, Project, ProviderConfig...
- `routes/providers.ts` — Provider config CRUD, warmup...
```

### Remediation

Secret handling requirements:

- Encrypt secrets at rest using KMS or libsodium.
- Never return full secrets in GET responses.
- Return only last-4 or fingerprint.
- Mark secret fields write-only in Zod schemas.
- Redact secrets before logging.
- Strip `Authorization` headers from provider errors.
- Audit all provider-config mutations.
- Scope provider configs to project/org.
- Require admin role for provider CRUD.

Example response:

```json
{
  "id": "pc_123",
  "provider": "openai",
  "apiKey": "sk-...abcd",
  "hasApiKey": true
}
```

Never:

```json
{
  "apiKey": "sk-full-secret"
}
```

---

## 15. Webhook alerts are a likely SSRF vector

- **Severity:** High
- **Pass:** 3
- **File:Line:** `apps/server/src/lib/webhook-alerts.ts`
- **Category:** security

### Description

A webhook alert system sends HTTP requests to a configured URL. If that URL is user-controllable, it is an SSRF surface. Attackers can target:

- `http://169.254.169.254/`
- `http://127.0.0.1`
- internal admin panels
- cloud metadata endpoints
- private services
- Redis/Postgres HTTP probes
- internal Docker APIs

If webhook signing is absent, receivers also cannot verify authenticity.

### Evidence

```text
- `lib/webhook-alerts.ts` — Threshold checking, re-exports
```

### Remediation

Implement SSRF protections:

- Allowlist domains/IPs.
- Deny private, loopback, link-local, and metadata IPs.
- Resolve DNS and re-check IP before request.
- Prevent DNS rebinding by pinning resolved IP.
- Use strict timeout.
- Limit redirects or disable them.
- Sign payloads with HMAC.
- Store webhook secrets securely.
- Rate-limit webhook dispatch.

Example denied CIDRs:

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1/128
fc00::/7
fe80::/10
```

---

## 16. Error-analysis and global error handling may leak secrets, stacks, and prompts

- **Severity:** High
- **Pass:** 3
- **File:Line:** `apps/server/src/routes/errors.ts`, `apps/server/src/app.ts:global error handler`
- **Category:** security

### Description

Error-analysis routes are dangerous if they expose raw provider errors, stack traces, prompts, diffs, or environment metadata. Provider SDK errors often include:

- request URLs
- request headers
- authorization header fragments
- organization IDs
- model names
- rate-limit metadata
- partial request bodies

A global error handler that returns `err.stack` or Zod internals can also leak implementation details.

### Evidence

```text
- `app.ts` — Express app, CORS, ZodError→400, global error handler
- `routes/errors.ts` — Error analysis
```

### Remediation

Return generic client errors:

```json
{
  "error": "internal_error",
  "requestId": "req_123"
}
```

Log full details server-side only.

Sanitize provider errors:

- remove headers
- remove tokens
- remove request bodies
- remove prompts
- remove file paths outside workspace
- truncate stack traces
- classify errors by code, not raw message

Do not expose `/errors` without admin auth.

---

## 17. `ensureTokenFresh` likely has refresh races and credential leakage in retry paths

- **Severity:** High
- **Pass:** 2
- **File:Line:** `packages/providers/src/openai.ts:ensureTokenFresh`
- **Category:** async

### Description

Token-refresh logic commonly has these defects:

- multiple concurrent requests trigger multiple refreshes
- one request uses a token while another invalidates it
- refresh failure is not cached, causing retry storms
- expired-token errors are retried forever
- Authorization headers appear in error logs
- token TTL clock skew is ignored
- refresh state is shared without mutex

Because this is in a provider adapter used by retries, a race can cause request failures, account lockouts, or credential leakage.

### Evidence

```text
- `openai.ts` — OpenAI-compatible provider (timeoutMs, maxRetries, ensureTokenFresh)
```

### Remediation

Use single-flight refresh:

```ts
let refreshPromise: Promise<Token> | null = null;

async function getToken(): Promise<Token> {
  if (token && !isExpired(token)) return token;

  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}
```

Also:

- add expiry margin, e.g. refresh 60 seconds early
- redact Authorization headers from errors
- do not retry credential errors as transient
- persist refresh failures to health registry
- lock per provider config ID

---

## 18. Orchestrator sub-agent spawning lacks visible depth, budget, and concurrency limits

- **Severity:** High
- **Pass:** 4
- **File:Line:** `packages/agent/src/orchestrator.ts`
- **Category:** logic

### Description

A planner/reviewer orchestrator that creates sub-agents can recursively spawn work. Without limits, this can cause:

- fork bomb behavior
- runaway LLM cost
- queue starvation
- infinite review loops
- cyclic task dependencies
- unbounded diff generation
- memory exhaustion
- provider rate-limit collapse

This is especially dangerous when combined with unauthenticated task creation.

### Evidence

```text
- `orchestrator.ts` — Multi-agent orchestrator (planner/reviewer + sub-agents), TaskDiff creation
```

### Remediation

Enforce hard limits:

- max orchestration depth
- max children per task
- max total descendants
- max wall-clock time
- max token spend
- max dollar cost
- max concurrent sub-agents
- cycle detection
- reviewer/planner loop cap
- abort propagation to descendants

Store hierarchy in DB:

```text
Task.parentId
Task.rootTaskId
Task.depth
```

Reject tasks exceeding limits before dispatch.

---

## 19. Background provider warmup likely swallows async errors

- **Severity:** High
- **Pass:** 2
- **File:Line:** `apps/server/src/routes/providers.ts:warmup`
- **Category:** async

### Description

The manifest says warmup runs in background with `.then/.catch`. This pattern often returns HTTP 200 immediately while the real operation fails silently. If the catch only logs, the system may believe a provider is warm or healthy when it is not.

Possible consequences:

- provider marked healthy despite auth failure
- credential errors hidden
- warmup latency metrics falsified
- unhandled rejection if catch is missing or throws
- route caller receives success for failed operation
- circuit breaker receives bad signals

### Evidence

```text
- `routes/providers.ts` — Provider config CRUD, warmup (background .then/.catch)
```

### Remediation

If warmup is user-triggered, make it synchronous or return a job ID:

```ts
POST /providers/:id/warmup
-> 202 { jobId: "warmup_123" }

GET /jobs/warmup_123
-> { status: "failed", errorClass: "credential_error" }
```

If background execution is required:

- record job state in DB
- update provider health on failure
- alert on repeated warmup failure
- do not log secrets
- ensure `.catch` cannot throw
- expose failure status through API

---

## 20. God modules make security review and safe refactoring impractical

- **Severity:** Medium
- **Pass:** 0
- **File:Line:** `packages/agent/src/executor.ts:1-2215`, `packages/router/src/intelligent.ts:1-841`, `apps/web/src/components/BenchmarkPanel.tsx:1-1440`
- **Category:** architectural

### Description

The codebase contains multiple excessively large modules. This is not merely aesthetic. Large modules hide:

- unsafe fallback paths
- dead code
- inconsistent error handling
- duplicated validation
- privilege escalation paths
- untested branches
- high cyclomatic complexity

`executor.ts` is especially dangerous because it contains security-critical logic: tool dispatch, retries, patch validation, checkpointing, and shell classification.

### Evidence

```text
- `executor.ts` — **2215 lines**
- `intelligent.ts` — **841 lines**
- `BenchmarkPanel.tsx` — 1440 lines
```

### Remediation

Split `executor.ts` into:

- `AgentLoop`
- `ProviderDispatcher`
- `ToolRegistry`
- `ToolExecutor`
- `PatchValidator`
- `CheckpointManager`
- `ShellPolicy`
- `RetryController`
- `AbortControllerManager`

Split `intelligent.ts` into:

- `ProviderHealthRegistry`
- `PerformanceCache`
- `StrategyLearner`
- `ScoringEngine`
- `FallbackCascade`
- `RouterPersistence`

Split `BenchmarkPanel.tsx` into:

- SSE subscription hook
- data store
- table components
- filter controls
- error banner
- run detail drawer

---

## 21. Multiple routing implementations create drift, orphan code, and inconsistent state

- **Severity:** Medium
- **Pass:** 1
- **File:Line:** `packages/router/src/intelligent.ts`, `packages/router/src/rules.ts`, `packages/router/src/tiers.ts`, `packages/router/src/difficulty-aware.ts`
- **Category:** architectural

### Description

There are at least four routing-related modules:

- `intelligent.ts`
- `rules.ts`
- `tiers.ts`
- `difficulty-aware.ts`

This is a classic AI-generated duplication pattern. It creates risks:

- one router is used in production while others are dead code
- different endpoints return different provider decisions
- circuit-breaker state is updated by one router but ignored by another
- persisted state becomes orphaned
- tests target the wrong implementation
- future changes fail to update all paths

The schema includes `ProviderCircuitState`, but only `intelligent.ts` clearly describes a health registry. Other routers may ignore circuit state entirely.

### Evidence

```text
packages/router/src/
- `intelligent.ts` — IntelligentRouter, ProviderHealthRegistry...
- `rules.ts