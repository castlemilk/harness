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
- After a graded run, re-run **only** the failing p2p tests once. If they pass,
  record them as flaky (disclosed in the verdict/metrics) rather than failing
  the task.
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
# 1. pre-flight: nothing else heavy on the box; Docker up if using T1.3
task dev                      # or: CODEX_EFFORT=max task dev

# 2. launch (adjust model/timeout; taskIds nested under deepswe)
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "models": [{"provider": "external:claude-code", "model": "claude-opus-5"}],
  "strategy": "single", "concurrency": 2, "timeoutMs": 1200000,
  "projectPrefix": "score-run",
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "taskIds": ["abs-stepped-slices","anko-default-function-arguments","sqlfmt-create-table-ddl-formatting","returns-validated-error-accumulation","sqlite-utils-safe-import-checkpoints","vulture-persistent-analysis-cache","narwhals-rolling-window-suite","psd-tools-blend-range-api"],
    "useDocker": false
  }
}'

# 3. watch; results land in BenchmarkHistory and on the Benchmarks tab
curl -s http://localhost:4000/bench/run/<id>
curl -s http://localhost:4000/foreman/benchmarks
```

Verifier artifacts (the ground truth for any claim about a score):
`~/.omega/work/deepswe/<task>-<timestamp>/verifier.log` — contains the
`reward.json` line and the per-test `[verifier] ✗ [f2p|p2p]` failures.

---

## 7. Suggested first move next session

Implement **T1.1 + T1.2**, turn on Docker (**T1.3**), then re-run the same 8
tasks **serialized** (T1.4) at n=3. That yields the first number worth
comparing across models. Everything in Tier 2 should wait until the
measurement is trustworthy — otherwise prompt changes will be evaluated
against noise.
