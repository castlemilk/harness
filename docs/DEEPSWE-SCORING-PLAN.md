# deep-swe scoring — state, diagnosis, and the plan

Handover written 2026-08-23. Everything below is grounded in a real campaign
(opus-5, gpt-5.6-sol-max, Ox Alpha Free) over the deep-swe suite. Numbers cited
are from run artifacts on disk, not estimates.

---

## 1. Where the number comes from

Latest opus-5 run (8 environment-verified tasks, after the environment repairs
landed) scored **1/8**. That headline is misleading — five of the eight never
produced a fair measurement:

| Task | Cause | Evidence |
|---|---|---|
| narwhals-rolling-window-suite | **infra — never ran** | `git clone` failed at 0s |
| psd-tools-blend-range-api | **infra — never ran** | `git clone` failed at 0s |
| sqlfmt-create-table-ddl-formatting | **infra — never ran** | `git clone` failed at 0s |
| vulture-persistent-analysis-cache | **false zero** | `f2p 24/24` (feature work perfect); one p2p failed, and it is a *different* test each run |
| abs-stepped-slices | near miss | `f2p 5/6` — missing `TestEvalAssignIndexRangeString` |
| anko-default-function-arguments | near miss | `f2p 1/2` — missing `TestDefaultArgumentsVisible`; env repair confirmed working (`p2p 118/118`) |
| returns-validated-error-accumulation | genuine miss | `f2p 0/159` (it PASSED in the previous run — variance) |
| sqlite-utils-safe-import-checkpoints | **pass** | — |

**3/8 was lost before the model was asked. 1/8 was a scoring artifact.** On the
five tasks that actually executed, the model did the required work on two
(pass + vulture) — 40%, not 12.5%.

The clone failures happened while a codex session was hammering the same
machine; GitHub was reachable minutes later. They are transient, not a
capability signal.

---

## 2. Plan

Ordered by expected gain per unit of effort. Tier 1 is pure recovery of losses
and needs no model change.

### Tier 1 — recover the losses (target: 1/8 → 3–4/8)

**T1.1 Retry + cache repo clones.**
`packages/bench/src/adapters/deepswe.ts:403` `cloneRepo()` has **no retry** — a
transient network blip is a permanent zero for that task.
- Wrap the clone/checkout in bounded retry with backoff (3 attempts).
- Add a local mirror cache: clone each repo **once** into a cache dir, then
  create per-task checkouts from the mirror (`git clone --reference` or a
  local clone). Across a 113-task sweep repos repeat, so this also removes
  hours of wall-clock and most of the rate-limit exposure.
- Acceptance: kill the network mid-sweep and confirm the task retries and
  succeeds rather than recording a 0s failure; confirm a second task on the
  same repo does not re-clone from the network.

**T1.2 Flake-aware p2p grading.**
vulture failed on one p2p test with `f2p 24/24`, and the failing test **differs
between runs** — a flake signature, not a pre-existing failure.
- After an eligible graded run, run one full confirmation verifier pass in the
  same project tree. A p2p failure is confirmed only when the same test fails
  in both runs; otherwise record it as flaky in the verdict/metrics.
- This is deliberately NOT the cached-baseline design (see §4) — it needs no
  persisted state and cannot be poisoned.
- Acceptance: a task whose only p2p failure passes on re-run scores as a pass,
  with the flake named in the verdict.

**T1.3 Run the verifier under Docker.**
The local verifier shares the host network namespace and a host venv — the root
cause of both the `:8080` collision and the pyarrow drift that needed per-task
repairs. `useDocker` is already plumbed
(`apps/server/src/lib/benchmark-runner.ts:140`); the Docker daemon was simply
down. Turning it on removes that whole class of false zeros and makes the
per-task overrides in §4 largely unnecessary.
- Acceptance: anko passes its p2p suite with **no** environment override
  applied.

**T1.4 Serialize scoring runs.**
All three clone failures and two of the opus timeouts coincided with a codex
session loading the machine. Scoring runs must not share the box with other
heavy work. Make this a documented pre-flight step, not a hope.

### Tier 2 — convert the near-misses (real capability, +1–2)

**T2.1 Add a "spec gate" to the task prompt.**
`packages/bench/src/adapters/deepswe.ts:371` `buildDeepSweDescription()`
currently enforces a BUILD GATE (line 381): build passes + *existing* tests
pass. Nothing makes the agent prove the **new** behaviour, which is exactly
where both near-misses died.
The hidden tests must stay hidden (that is the benchmark's premise — do NOT
leak `f2p_node_ids` into the prompt; that is cheating, and it would also
invalidate every historical comparison). Instead require the agent to:
1. enumerate each observable behaviour the instruction specifies (exact error
   text, formatting, signatures, boundary/negative cases),
2. write throwaway tests for each, run them, fix failures,
3. delete the throwaway tests before finishing.
Both observed misses were edge semantics (string-range assignment;
default-argument visibility) — precisely what a boundary-case pass catches.

**T2.2 Tell the agent its remaining time budget.**
sol wall-clocked all 8 tasks (1809–1998s at a 1800s cap) while opus finished in
400–1200s. A model that knows its deadline can prioritize; one that doesn't
burns the budget exploring.

### Tier 3 — stop the number lying (no true-score change)

**T3.1 n ≥ 3, report pass@k and variance.** returns-validated and vulture both
flipped between runs; opus went 2/8 → 1/8 on an identical task set; sol scored
2/8 twice on *different* task sets. At n=1 these numbers cannot rank models.

**T3.2 Track partial reward as a secondary metric.** abs scored `partial 0.917`
— real progress a binary hides. Surface it on the Benchmarks tab so
improvement is visible before it flips a pass.

**T3.3 Keep skills OFF for scoring runs.** `.agents/skills` holds **36**
`solution.patch` skills from previous solves. One made abs-stepped-slices
"pass" in 24s with 0 tokens in an early run. That is the self-improvement loop
working as designed, but it measures the library, not the model. External-CLI
runs do not inject skills today; the internal agent loop does — never score the
internal path against a task whose skill exists.

---

## 3. Traps that already cost time — do not rediscover these

- **pglite is single-writer.** Stop `task dev` before `task db:seed:e2e` or any
  script that opens the DB, or it hangs with no error.
- **The server caches `@omega/bench` at first import.** A rebuild does NOT
  affect a running server — you must restart to pick up adapter changes.
  Corollary: an in-flight bench run is immune to rebuilds, which is how to make
  a measurement reproducible while editing.
- **`codex exec` hangs without `< /dev/null`** when launched detached.
- **Cancelled bench runs write no `BenchmarkHistory` row**, so their per-task
  results are lost. Do not cancel a run you intend to report.
- **An orphaned `running` run blocks new ones** (`A benchmark run is already in
  progress`) — cancel it via `POST /bench/run/:id/cancel` first.
- **`deepswe.taskIds` vs top-level `taskIds`**: both are accepted by the
  schema. Nested wins now (fixed), but a 2-task request once launched all 113.
- **Bench work happens in a worktree**, not the project dir
  (`~/.omega/work/worktrees/<project>-<taskid>`). Looking at the project path
  and seeing an empty `src/` means nothing.

---

## 4. Held work — read before touching grading

`docs/held/baseline-p2p-grading.UNREVIEWED.diff` is a complete, **unreviewed
and unsafe** implementation of baseline-aware p2p grading (cache the set of
p2p tests that fail on a clean tree; exclude them from grading). An adversarial
review rejected it. Do not resurrect it as-is. Blocking defects:

1. Its central property — "the baseline is computed on a clean tree" — is not
   asserted anywhere. `git stash` + `checkout -f` do **not** remove ignored
   files, the harness itself appends `.venv/` to `.gitignore`, and the verifier
   runs with `.venv/bin` on PATH. Model-controlled code (a `sitecustomize.py`)
   can therefore execute inside the "clean" baseline run and poison a
   **permanent, never-invalidated** cache.
2. No cap on the exclusion fraction: one broken environment at baseline time
   caches the *entire* p2p whitelist as pre-existing, after which a model that
   breaks every existing test scores `reward=1`.
3. The cache key has no schema version and no hash of `tests/config.json`.
4. `p2p_total` silently changes meaning in persisted metrics (raw vs effective).
5. Graded-side "missing from report" is not distinguished from a real failure,
   so deleting a baseline-failing test is forgiven.
6. A restore hiccup throws past reward computation and destroys a valid grade.

**T1.2 (re-run the failing p2p tests once) achieves most of the intent with no
persisted state and none of these risks.** Prefer it. If a baseline is ever
genuinely needed, compute it in a throwaway `git worktree` or fresh clone —
never in the agent's tree — and require a failure to reproduce across N clean
runs before trusting it (vulture proves single-run baselines are wrong).

---

## 5. Landed this campaign (for context)

- `4f269f1` — `/app` path rewriting corrupted test ids in both directions. 428
  psd-tools ids were unmatchable for every model on every run; the first fix
  regressed 20 ids across four other tasks (missing `\b`). Verified by a
  whole-corpus scan: 428 fixed, 0 regressed.
- `89298e8` — orchestrated subtasks ignored the parent's pinned model (a task
  pinned to ox-alpha ran its first subtask on kimi). Invalidates any model
  comparison run through the orchestrator.
- `189afd5` — repaired the narwhals (pyarrow) and anko (`:8080`) environments,
  with the anko exclusion gated on a live port probe so a real regression in
  that test still fails.
- `da534d9` — retry classification (transient vs terminal), circuit breakers on
  the external-CLI path, and session capture/resume.
- T1.1/T1.2 (this working tree) — retrying bare-mirror clone cache plus bounded,
  same-tree flake confirmation. The verifier now removes patch-created paths
  that survived `git checkout -f` before applying the stored patch and emits
  `patch_paths_cleaned_count` when it does so. A task with this metric is not
  directly comparable across this change if its historical result was
  `apply_failed`.

Note on `da534d9`: the classifier is the piece most likely to need tuning. It
was initially treating any bare `5xx`/`429` token as a provider fault, which on
a test-fixing benchmark is the *common* case (`expected status 503, got 200`)
and would have multiplied spend on failures that can never pass. It is now
HTTP-context-anchored with assertion/patch signals classified terminal first.
If retry costs look wrong, probe `classifyRetryFailure()` directly before
assuming the policy is at fault.

---

## 6. How to run a scored sweep

```bash
# 1. exclusive-host pre-flight (run before every scored sweep)
# With the API up, this must print no pending/running run. Cancel only a
# genuinely orphaned run with the POST shown below.
curl -s 'http://localhost:4000/bench/run?limit=100' |
  jq -r '.[] | select(.status == "pending" or .status == "running") | [.id,.status,.suite] | @tsv'
curl -s -X POST http://localhost:4000/bench/run/<orphaned-id>/cancel

# Quit or pause every unrelated Codex/Claude session and other heavy job.
# Wait until no unrelated process is consuming sustained CPU and the 1-minute
# load is below the machine's logical CPU count. Docker must be healthy.
ps -Ao pid,%cpu,command | sort -k2 -nr | head -20
pgrep -fl 'codex|claude'          # no session listed here may be doing work
uptime; getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.logicalcpu
df -h
docker info >/dev/null

task dev                      # only if the API is not already up

# 2. launch (adjust model/timeout; taskIds nested under deepswe)
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "models": [{"provider": "external:claude-code", "model": "claude-opus-5"}],
  "strategy": "single", "concurrency": 1, "timeoutMs": 1200000,
  "projectPrefix": "score-run",
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "taskIds": ["abs-stepped-slices","anko-default-function-arguments","sqlfmt-create-table-ddl-formatting","returns-validated-error-accumulation","sqlite-utils-safe-import-checkpoints","vulture-persistent-analysis-cache","narwhals-rolling-window-suite","psd-tools-blend-range-api"],
    "useDocker": true
  }
}'

# 3. watch; results land in BenchmarkHistory and on the Benchmarks tab
curl -s http://localhost:4000/bench/run/<id>
curl -s http://localhost:4000/foreman/benchmarks
```

Verifier artifacts (the ground truth for any claim about a score):
`~/.omega/work/deepswe/<task>-<timestamp>/verifier.log` — contains the
`reward.json` line and the per-test `[verifier] ✗ [f2p|p2p]` failures.

### Clone and flake safeguards

DeepSWE clones use a retrying, atomic bare-mirror cache under Omega's work
directory. Override its location with `OMEGA_DEEPSWE_REPO_CACHE_DIR`, or set
`OMEGA_DEEPSWE_DISABLE_REPO_CACHE=1` to use the retrying direct-clone path.
These are full Git mirrors: the corpus currently has 92 distinct repository
URLs, so budget substantial disk and inspect `df -h` before a sweep. A new
mirror creation or fetch is skipped when its cache volume has less than
`OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB` free (default 15 GiB). This box currently
has about 26 GiB free, so only part of the 92-repository mirror set can be built
before that floor stops further cache growth. Clone setup has a single overall
deadline controlled by `OMEGA_DEEPSWE_CLONE_DEADLINE_MS` (default 2,700,000 ms /
45 minutes); it bounds the whole of `cloneRepo`, including the direct fallback.
The cache currently has no eviction or TTL. Known limitation: bare clones do
not fetch Git LFS objects, so a mirror-served checkout of an LFS repository can
contain pointer files.

A failed run with complete f2p and only a small p2p shortfall gets exactly one
full, same-patch confirmation run in the same project tree, without a fresh
clone or dependency rebuild; a failure counts only when it appears in both
runs. There is no persisted grading baseline, first-run metrics remain primary,
and rerun evidence is disclosed under separate metrics. The effective p2p
shortfall cap is
`min(OMEGA_DEEPSWE_FLAKE_MAX_P2P_FAILURES, max(1, floor(2% * p2p_total)))`,
with an absolute default of 3, so one failure is eligible even in a small
suite. Set `OMEGA_DEEPSWE_DISABLE_FLAKE_RERUN=1` to disable confirmation.
`OMEGA_DEEPSWE_FLAKE_MAX_RERUNS` caps confirmations per suite load (default
1024). `EvaluationContext` currently exposes no stable model or variance-
repetition identity, so this safety valve remains one first-come-first-served
budget shared by every model and repetition using that suite load. The raised
default is intended not to bind in a normal sweep; explicit exhaustion remains
visible in `flake_rerun_skipped_reason`.

An upgraded pass emits `flake_forgiven_pass: 1`; Tier 3 reporting should filter
or chart those results as a separate series. Audit forgiven passes with
`p2p_rerun_failure_disjoint: 1` first: that shape means the non-empty p2p
failure sets were disjoint, and can also indicate xdist worker crashes or
order/global-state defects. Filter on both `flake_forgiven_pass` and
`p2p_rerun_failure_disjoint`, then read both full verifier logs referenced by
`verifier_log_file` and `verifier_log_file_rerun`. Detailed gate/inconclusive
causes use the single `flake_rerun_skipped_reason` metric.

### Docker verifier (T1.3) — verified 2026-08-23

The eight scoring-set images are pre-built locally under the tag the adapter
expects (`omega-deepswe-<task>`), so a sweep pays no build time:

```bash
docker build -t "omega-deepswe-$t" -f deep-swe/tasks/$t/environment/Dockerfile \
  deep-swe/tasks/$t/environment
```

Acceptance evidence for anko — the task whose `Example_vmHttp` needed the
`:8080` exclusion on the local path. Run with an *unrelated host process
actually holding :8080*, an empty `model.patch`, and no environment override
applied (the Docker path applies none):

```
{"reward": 0, "f2p_total": 2, "f2p_passed": 0,
 "p2p_total": 119, "p2p_passed": 119, "p2p": 1.0}
```

`p2p 119/119` — one test *more* than the local path's 118, because the excluded
test now runs and passes inside the container's own network namespace. The
override in `EXTRA_TASK_DEPS` is left in place for the local path; it is gated
on a live port probe, so it is inert under Docker. f2p 0/2 is expected with an
empty patch.

---

## 7. Suggested first move next session

Tier 1 has landed (T1.1, T1.2, T1.4 in `db5d7ec`; T1.3 verified above). The
next move is the measurement itself: run the same 8 tasks **serialized**
(`concurrency: 1`, exclusive host, `useDocker: true`) at **n=3**, per T3.1.
That yields the first number worth comparing across models.

Two things to watch on that first sweep, because it is their first production
execution:

- any `flake_forgiven_pass: 1` row — audit `p2p_rerun_failure_disjoint` first
  and read both verifier logs (§6);
- the same-tree re-run's second `git apply` of the stored patch. Its
  precondition (`removePatchPathsMissingFromBase`) is unit-tested in isolation,
  but no test drives the local verifier twice end to end.

Everything in Tier 2 should wait until the measurement is trustworthy —
otherwise prompt changes will be evaluated against noise.
