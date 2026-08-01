# Adversarial Review by kimi (k3)

Duration: via harness task | Tokens: ?

---

# Adversarial Review: Omega Harness

## Preliminary Verdict — Review Integrity Check

Before any findings: **no source code was provided.** What was submitted is an architectural inventory — file names, line counts, and one-line descriptions. The rubric demands `File:Line` locations and `Evidence: code snippet or trace` for every finding. I cannot supply those without fabricating them, and a review full of invented line numbers and hallucinated code snippets would itself be the exact AI slop this exercise is designed to catch. I won't do that.

What I *can* do legitimately, and will:

1. Execute **Pass 0 honestly** — the inventory itself is auditable evidence.
2. Produce a **prioritized hypothesis ledger** — findings the inventory strongly suggests, each labeled with severity-*if-confirmed* and the exact evidence required to confirm or kill it.
3. Give a **provisional architecture grade** and AI-generation assessment, since the inventory is real evidence for those.

Any finding below without quoted code is a **hypothesis, not a confirmed defect.** Treat it as an audit work order.

---

## PASS 0 — Pre-Audit Inventory (fully executable on provided material)

### God Modules
| Module | Size | Concern |
|---|---|---|
| `packages/agent/src/executor.ts` | **2215 lines** | Single file containing retry logic, provider I/O, tool dispatch, patch publish/validate, git checkpointing, shell classification, and deadline computation. That is ≥6 distinct responsibilities. Almost certainly the highest-blast-radius file in the repo. |
| `apps/web/src/components/BenchmarkPanel.tsx` | **1440 lines** | God component. SSE lifecycle + rendering + state in one file is a classic leak/teardown hazard zone. |
| `packages/router/src/intelligent.ts` | **841 lines** | Five classes (Router, HealthRegistry, PerformanceCache, StrategyLearner, ScoringEngine, FallbackCascade) in one file. Each is independently testable; co-location invites shared-mutable-state coupling. |

### AI-Generation Markers (visible in inventory alone)
- **Strategy proliferation**: four routing modules — `rules.ts`, `tiers.ts`, `difficulty-aware.ts`, `intelligent.ts` — with overlapping mandates ("selectProvider", "pickModelFromConfigs", "selectProviderWithHistory"). This is the signature of multi-session generation where each session added a new abstraction instead of consolidating. **Pattern drift confirmed at inventory level.**
- **Duplicate responsibility**: `TaskDiff creation` appears in both `orchestrator.ts` and `external.ts`. Near-certain duplicated diff-construction logic.
- **Versioned artifact**: "persistence v2" implies a v1 schema existed; no migration path is listed.
- **Prompt-as-code smell**: `FORCE_ACTION_PROMPT` — compensating for model behavior via an aggressively named prompt constant rather than fixing the loop logic.
- **Self-annotated fixes**: "splice-skip bug fixed" — indicates mutation-during-iteration existed; fixes of this class frequently have siblings nearby.

---

## Hypothesis Ledger (severity-if-confirmed)

### H1 — Critical — Security — `executor.ts`, `isReadOnlyShellCommand`
**Pass 3.** The inventory states the classifier works by *splitting on `|&&|||;`*. String-split shell parsing is not a security boundary. Unaddressed bypass classes until proven otherwise:
- Command substitution: `$(cmd)` and backticks contain none of the split tokens.
- Newline separation (`\n`) is not in the delimiter set.
- Output redirection (`>`, `>>`) — `echo x > /etc/cron.d/pwn` has no split tokens.
- Benign first-token, malicious payload: `find . -exec rm {} +`, `awk 'BEGIN{system("...")}'`, `sed 'e cmd'`, `tar --checkpoint-action=exec=...`, `git -c core.pager=... `.
- `xargs`, `env`, `sh -c`, `eval` as second-stage launchers.

**Why it matters:** this gate presumably decides whether agent-generated shell runs unmediated. **Evidence required:** full function body + every call site + what "read-only" actually gates. **Remediation:** allowlist of exact binaries with per-subcommand policies, deny metacharacters wholesale, and run commands in a sandbox regardless of classification.

### H2 — Critical — Security — entire `apps/server` surface
**Pass 3.** The inventory describes CORS, validation, and error handling — and **zero authentication or authorization middleware** on any route. If absent, this is unauthenticated CRUD over: provider API keys (`routes/providers.ts`), arbitrary task dispatch (agent executes shell + edits files), benchmark orchestration, and cost/trace data. That is unauthenticated remote-code-execution-as-a-feature plus credential disclosure. **Evidence required:** `app.ts` middleware chain. **Remediation:** auth middleware before all routes; per-project authorization checks (otherwise IDOR).

### H3 — High — Security — `routes/providers.ts` + `schema.prisma` `ProviderConfig`
**Pass 3.** Provider credentials stored in DB with a CRUD API in front. Three questions that each fail independently: (a) encrypted at rest or plaintext? (b) does GET serialize `apiKey` back to the client? (c) does `toCoreConfig` or the trace ring buffer capture the key into logs? **Evidence required:** route serializers, schema fields, `utils.ts:toCoreConfig`, `trace-log.ts` write paths.

### H4 — High — Security — `executor.ts` / `tools.ts` patch paths
**Pass 3.** `apply_patch`, `publish/validate_patch`, `applyLatestPatch` (3-way fallback): LLM-generated patch content applied to a real working tree. Classic defects: `../../` path traversal in patch headers, absolute paths, symlink following. **Evidence required:** path canonicalization before write.

### H5 — High — Logic — `packages/providers/src/kimi.ts` "forces temperature: 1"
**Pass 4/6.** A hardcoded sampling override silently diverging from user config. Temperature 1 for a *coding agent* maximizes nondeterminism — and this repo runs **benchmarks and consensus evaluation** on outputs. If benchmark runs inherit this, results across providers aren't comparable and `strategy-eval`/`consensus` statistics (Wilson bounds in `PerformanceCache`) are being fed degraded, high-variance samples for Kimi. This smells like a hallucination-compensating hack ("Kimi errors at other temperatures") that leaked into prod. **Evidence required:** the override and whether `SendOptions` can override it back.

### H6 — High — Logic — `warmup.ts` "fixed latency reporting"
**Pass 4.** If warmup writes a *fixed* (synthetic) latency into the same performance store the ScoringEngine reads, it poisons the router's Wilson-lower-bound rankings with fabricated data. Warmup results must be quarantined from production stats. **Evidence required:** where warmup latency is persisted.

### H7 — High — Async — `bench/runner.ts` `ensureGitRepo shared` + `task-queue.ts` (pool of 3)
**Pass 2/4.** A **shared** git repo with commit/revert semantics under a 3-wide concurrency pool is a race condition with a body count: interleaved `git checkout`/`commit`/`revert` across concurrent benchmark runs → index locks, cross-contaminated diffs attributed to the wrong strategy, and reverts destroying another run's checkpoint. `checkpointCommit` in the executor compounds this. **Evidence required:** is the repo per-run (worktree) or genuinely shared?

### H8 — High — Security — `external.ts` External CLI runner
**Pass 3.** Task text flowing into `codex`/`claude-code` CLI invocation. If built via string interpolation with `shell: true`, it's argument/shell injection from untrusted task input. **Evidence required:** `spawn` vs `exec`, argument array construction.

### H9 — Medium — Security — `lib/webhook-alerts.ts`
**Pass 3.** User-configurable webhook URLs = textbook SSRF against internal infrastructure. Also: do alert payloads contain task content/keys? **Evidence required:** URL validation (scheme, IP range denylist) and payload construction.

### H10 — Medium — Security — SSE endpoints (`routes/tasks.ts`) + `BenchmarkPanel.tsx` EventSource
**Pass 2/3.** `EventSource` cannot set `Authorization` headers. The two standard workarounds are (a) token in query string — leaks into access logs, browser history, `Referer`; or (b) cookies — CSRF exposure. Also verify EventSource teardown on unmount across *all* panels, not just BenchmarkPanel. **Evidence required:** SSE auth mechanism.

### H11 — Medium — Logic — pagination `limit/offset` in `routes/tasks.ts`
**Pass 3/4.** No stated max-limit clamp. `?limit=10000000` → unbounded Prisma fetch → memory exhaustion. Trivial fix, commonly missed by generators. **Evidence required:** Zod schema bounds.

### H12 — Medium — Architectural — router dual source of truth
**Pass 1/4.** In-memory `ProviderHealthRegistry` (circuit breaker) **plus** persisted `ProviderCircuitState` table **plus** "persistence v2". Questions: who wins on restart? Is half-open state shared across concurrent probe requests (stampede)? Is there a v1→v2 migration, or is v1 data orphaned? **Evidence required:** registry hydration path.

### H13 — Medium — Async — singleton init race, `lib/intelligent-router.ts`
**Pass 2.** Promise-based init is correct only if the promise is captured at first call and `shutdownRouter()` nulls it atomically. Check: bootstrap "orphaned task recovery" vs. router readiness ordering — tasks dispatched before init completes silently take the non-agent fallback path. **Evidence required:** `index.ts` boot sequence.

### H14 — Medium — Security — `lib/trace-log.ts` ring buffer
**Pass 5.** Traces of an agent that edits files and runs commands will contain file contents, command lines, and possibly env/secrets. Ring buffer eviction policy unstated (per-key unbounded `Trace[]`?). Confirm redaction and per-key caps.

### H15 — Low — Quality — `ZodError→400` global handler
**Pass 5.** Confirm the handler doesn't serialize Zod internals or stack traces to clients in production, and that it isn't the *only* thing standing between bad input and the 500 handler.

### H16 — Informational — Regression — "splice-skip bug fixed"
**Pass 6.** The annotation proves mutation-during-iteration shipped once. Audit the fix's neighbors: task-queue removal, health-registry eviction, cache pruning loops are the same bug class.

---

## Summary

- **Critical/High count (confirmed): 0 — no code was provided, so nothing can be honestly confirmed.** Hypotheses at Critical: 2 (H1, H2); High: 5 (H3–H8). If even H2 alone confirms, the system is unauthenticated RCE with key disclosure.
- **Top 3 most dangerous hypotheses:** (1) **H2** — no auth surface mentioned anywhere; (2) **H1** — delimiter-split shell classifier guarding agent command execution; (3) **H7** — shared git repo under a 3-wide benchmark pool (data integrity *and* availability).
- **Architectural health grade: C+ (provisional, inventory-only).** Real strengths visible: workspace separation, circuit-breaker design, concurrency cap, Zod at the boundary, SIGTERM/shutdown handling. Dragging it down: a 2215-line executor, a 1440-line component, four parallel routing strategies, duplicated TaskDiff creation, and no visible auth layer.
- **AI-generation confidence: ~90%.** Evidence *from the inventory alone*: uniform one-clause doc-comment style on every file; strategy proliferation instead of consolidation; "persistence v2" versioning artifact; `FORCE_ACTION_PROMPT` as behavioral patch; self-narrated bug fixes ("splice-skip bug fixed"); the `kimi.ts` temperature-1 hack; and near-duplicate responsibilities (`TaskDiff creation` ×2, three warmup/retry modules). These are the canonical multi-session AI drift patterns.

## To complete the review for real

Send, in priority order: (1) `executor.ts` in full — especially `isReadOnlyShellCommand`, tool dispatch, `checkpointCommit`; (2) `apps/server/src/app.ts` + one representative route (providers); (3) `external.ts` CLI invocation; (4) `bench/runner.ts` repo management; (5) `lib/utils.ts` + `trace-log.ts`; (6) `package.json` for the dependency-hallucination pass. With actual code I'll deliver findings with real line numbers and quoted evidence — and retract any hypothesis above that the code refutes.