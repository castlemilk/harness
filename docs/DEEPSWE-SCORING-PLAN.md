# deep-swe scoring — state, diagnosis, and the plan

Handover written 2026-08-23 and updated 2026-08-24 with the fast-feedback
implementation. Everything below is grounded in a real campaign (opus-5,
gpt-5.6-sol-max, Ox Alpha Free) over the deep-swe suite. Numbers cited are from
run artifacts on disk, not estimates.

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

### 1b. After Tier 1 — the same 8 tasks, 2026-08-23 (run `4e8be75d`)

Same task set, same model (opus-5), `concurrency: 1`, `useDocker: true`, mirror
cache on an external volume. Scored **4/8** at the time; it was really **5/8** —
narwhals was a correct solve that a broken environment scored as a zero (see
"narwhals" below). 2h01m, $22.58 / 83.7M tokens.

| Task | Verdict | Evidence |
|---|---|---|
| abs-stepped-slices | **pass** | `f2p 6/6`, `p2p 6/6` (was `f2p 5/6`) |
| psd-tools-blend-range-api | **pass** | `f2p 45/45`, `p2p 979/979` — had never run |
| returns-validated-error-accumulation | **pass** | `f2p 159/159` (was `0/159`; it has now flipped both ways — variance, see T3.1) |
| sqlite-utils-safe-import-checkpoints | **pass** | `f2p 60/60`, `p2p 1038/1038` |
| anko-default-function-arguments | near miss | `f2p 1/2`, **`p2p 119/119`** — same near miss as before, but one p2p test *more* than the local path and **no override applied** |
| vulture-persistent-analysis-cache | genuine miss | `f2p 23/24`, **`p2p 295/295`** — the p2p flake did not recur under Docker |
| sqlfmt-create-table-ddl-formatting | agent timeout | cut at the 20-min cap; graded `f2p 32/32`, `p2p 1248/1273` |
| narwhals-rolling-window-suite | **actually a pass** | scored `f2p 98/103`, `p2p 9752/10093`, but that was pyarrow drift, not the patch. Replaying the same stored patch with the pin applied gives `f2p 103/103`, `p2p 10093/10093` |

What this does and does not show:

- **T1.1 worked.** Eight of eight tasks cloned; zero clone failures against
  three lost last time. Every checkout logged `source=fresh-mirror
  attempts=mirror-clone:1,local-clone:1`.
- **T1.3 worked, in production — with one costly gap.** All eight graded under
  `Using Docker image omega-deepswe-*`, and **zero** environment overrides were
  applied. For `:8080` that was correct: the container's own network namespace
  makes the exclusion unnecessary. For pyarrow it was the bug — the Docker path
  applied no pip pins at all, which cost narwhals a genuine pass. Fixed
  2026-08-25; the Docker path now applies and discloses them.
- **T1.2 never fired.** The gate declined on all four failures, correctly each
  time: anko, vulture and narwhals had incomplete f2p, and sqlfmt's shortfall of
  25 is far past the cap of 3. The forgiven-pass path remains unexercised in
  production. Worth noting for whoever revisits it: sqlfmt's log carried exactly
  25 `✗ [p2p]` lines against a reward shortfall of 25, so the parser and the
  grader's own count agree on real data.
- **The flake T1.2 was built for may have been an environment artifact.**
  Vulture's single rotating p2p failure was seen three times on the local path
  and did not appear under Docker (`295/295`). T1.3 may have removed its cause.
- **4/8 is not yet a scoreable number.** n=1, and the host was at load ~60 on
  12 CPUs (other sessions) throughout. Both timeouts are consistent with that.
  It is evidence that Tier 1 recovered the losses it targeted — the plan
  predicted 3–4/8 — not a model measurement.
- **Two of the four failures are now budget failures, not capability failures.**
  That makes **T2.2** (tell the agent its remaining time) the highest-value
  Tier 2 item, ahead of T2.1, and argues for raising `timeoutMs` above 20 min
  for the two big-suite tasks.
- **The 20-minute limit was binding on 2/8 tasks.** Use at least 30 minutes
  (`timeoutMs: 1800000`) for scoring sets that include sqlfmt or narwhals, and
  continue to treat timeout-sensitive results as host-load dependent.
- **This 4/8 run predates both Tier 2 prompt changes:** the explicit time-budget
  guidance and the exactness treatment (including its now-removed marker-gate
  predecessor). Runs made with either change enabled are a new measurement
  series and are not directly comparable to this baseline.

### 1c. First ox-alpha sweep — 2026-08-25 (run `7c8a47d7`)

First full-set run on the free model (`external:opencode` /
`opencode-go/ox-alpha-free`) — chosen over the OpenRouter wiring deliberately,
because the internal agent loop's `applySkillPatches` would have injected
stored solution patches for 3 of the 8 tasks and short-circuited them to
instant passes (§3). n=1, serialized, Docker, 30-minute budgets, corrected
grading (the pyarrow pin live and disclosed), Tier 2 prompt treatment ON —
this is the first run of the post-Tier-2 series. **4/8**, 3h53m, **$0**
(free model, `totalCostUsd: 0`, ~15.6M tokens).

| Task | Verdict | Evidence |
|---|---|---|
| abs-stepped-slices | **pass** | `f2p 6/6`, `p2p 6/6` |
| psd-tools-blend-range-api | **pass** | `f2p 45/45`, `p2p 979/979` |
| sqlfmt-create-table-ddl-formatting | **pass** | `f2p 32/32`, **`p2p 1273/1273`** — a perfect p2p where opus timed out with 25 regressions |
| sqlite-utils-safe-import-checkpoints | **pass** | `f2p 60/60`, `p2p 1038/1038` |
| anko-default-function-arguments | near miss | `f2p 1/2`, `p2p 119/119` — identical to opus's three byte-identical repetitions |
| vulture-persistent-analysis-cache | near miss | `f2p 23/24`, `p2p 291/295` — the 4 p2p failures are model damage this time (clean 295/295 baseline) |
| narwhals-rolling-window-suite | capability miss | `f2p 72/103`, **`p2p 10093/10093`** — first genuinely winnable run; the environment repair held in production |
| returns-validated-error-accumulation | miss | `f2p 0/159`, `p2p 61/61` — flipped again, see below |

What it shows:

- **The narwhals repair works in a real run.** `p2p 10093/10093` graded, with
  the pin disclosed in `appliedEnvironmentOverrides`. The miss is genuine
  capability (unfinished feature work), not environment.
- **sqlfmt is a budget story, not a capability story.** The free model passed
  it with a *perfect* p2p under the 30-minute budget that opus lacked at 20.
  When a cheaper model cleanly solves a task a frontier model "failed", the
  first suspect is the clock, not the model.
- **anko is deterministic across models.** The same `f2p 1/2, p2p 119/119`
  near-miss from four opus repetitions reproduced exactly on a different
  model. Whatever the gap is, it is stable and spec-shaped (the instruction's
  exact error string), which keeps it the canonical probe for exactness
  interventions.
- **returns-validated's flip-flop is at least partly model-dependent.** Under
  Docker — same environment, same grading — opus scored `159/159` and ox-alpha
  `0/159`. The earlier "the variance looked environmental and Docker removed
  it" conclusion (§1b) holds only for the *local-path* flake; this task
  separately varies by model, so T3.1 variance claims must name the model.
- **3 of 4 misses were timeout cuts** (narwhals, returns-validated, vulture all
  exceeded 1800s; anko finished at 25.9m), and the host sat at load ~44 on 12
  CPUs for the whole run — other sessions again. Timeout-sensitive results
  remain host-load-dependent; the f2p/p2p instruments stay readable.
- **The no-marker disclosure works in production.** `graded_patch_added_test_paths`
  reported 2 paths on sqlfmt and 1 on vulture — models leave unmarked test
  files in the graded patch, exactly as the ox-alpha smoke test predicted, and
  the harness now discloses them without needing model compliance.
- **The flake gate declined on all four misses**, correctly each time
  (incomplete f2p). The forgiven-pass path remains unexercised.

Cross-model so far (both n=1, Docker, corrected grading, 30-min budget):

| Model | Score | Misses |
|---|---|---|
| opus-5 (§1b, corrected) | 5/8 | anko, vulture, sqlfmt (timeout) |
| ox-alpha-free (this run) | 4/8 | anko, narwhals, returns-validated, vulture |

anko and vulture are common near-misses; the rest are disjoint. Both headline
numbers are n=1 on a contended host — directional, not scoreable.

---

## 2. Plan

Ordered by expected gain per unit of effort. Tier 1 is pure recovery of losses
and needs no model change.

### Fast feedback — grade first, rerun the model only when needed

**H1 Replay stored patches — implemented.** `POST /bench/run` accepts exactly
one replay selector: a prior benchmark run or an explicit non-empty list of
harness task IDs. The runner resolves each source task and its stored
`TaskDiff`, prepares a fresh checkout at the task's base commit, and invokes the
normal verifier without creating a new model task or making a provider call.

Replay a whole stored run:

```bash
curl -s -X POST http://localhost:4000/bench/run \
  -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "replay": {"fromRunId": "<source-benchmark-run-id>"},
  "concurrency": 1,
  "timeoutMs": 1800000,
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "useDocker": true
  }
}'
```

Replay selected stored harness tasks:

```bash
curl -s -X POST http://localhost:4000/bench/run \
  -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "replay": {
    "fromHarnessTaskIds": ["<source-harness-task-id>", "<another-task-id>"]
  },
  "concurrency": 1,
  "timeoutMs": 1800000,
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "useDocker": true
  }
}'
```

Every replay result carries `replay: 1` and
`replay_source_task_id: <source-harness-task-id>`. Replay history is also
stored under provider `replay`, so it can be excluded from model comparisons.
`costUsd` and `totalTokens` are explicitly `0`: verifier work spends no model
tokens and source usage is never copied forward. A source with no non-empty
stored patch is reported as an explicit skipped-verifier failure, not graded as
an empty-patch zero.

**Replay-from-run is not durable — the committed corpus is.** A `replay` by
`fromRunId` / `fromHarnessTaskIds` resolves the stored `TaskDiff` out of the
harness database, and those rows do not survive indefinitely. Attempting to
replay run `4e8be75d` on 2026-08-25 failed with
`Replay source harness task not found: 14a8817a-…` — its harness tasks were
already gone, weeks of runs having rotated through. Use `fromRunId` for quick
iteration on a run you just did; for anything you want to be able to re-grade
later, promote it into the golden corpus, where the patch is a committed file
with a sha256 rather than a database row.

**H2 Golden grading corpus — implemented.** The checked-in manifest and patch
files under
`packages/bench/fixtures/deepswe-golden/t1-shakedown/` pin these four outcomes
from Docker run `4e8be75d-cfa3-4063-8a7c-c50532b56dcf`:

| Shape | Task | Expected reward summary | Source task duration (setup excluded) |
|---|---|---|---:|
| Clean pass | `abs-stepped-slices` | pass; f2p `6/6`, p2p `6/6` | 466,853 ms (7m47s) |
| Stable near-miss | `anko-default-function-arguments` | fail; f2p `1/2`, p2p `119/119` | 642,175 ms (10m42s) |
| Regression-heavy fail | `sqlfmt-create-table-ddl-formatting` | fail; f2p `32/32`, p2p `1248/1273` | 1,816,356 ms (30m16s) |
| Big suite, clean pass | `narwhals-rolling-window-suite` | pass; f2p `103/103`, p2p `10093/10093` (re-baselined 2026-08-25 — the original `98/103` / `9752/10093` recorded a broken environment) | 1,911,072 ms (31m51s) |

Run the complete corpus with `pnpm bench:deepswe:golden`, or one fixture with
`pnpm bench:deepswe:golden -- --task abs-stepped-slices`. The command verifies
each patch checksum, runs setup and the Docker verifier, prints actual versus
expected counts, and exits non-zero on any drift. This deliberately pins
**grading**, not model capability: it proves how the current verifier treats
four already-produced patches. Any changed outcome needs a deliberate grading
decision and fixture update.

### Tier 1 — recover the losses (target: 1/8 → 3–4/8)

**T1.1 Retry + cache repo clones — implemented.**
Before Tier 1, `cloneRepo()` had no retry, so a transient network blip was a
permanent zero for that task. It now uses bounded retries and a local mirror
cache.
- Wrap the clone/checkout in bounded retry with backoff (3 attempts).
- Add a local mirror cache: clone each repo **once** into a cache dir, then
  create per-task checkouts from the mirror (`git clone --reference` or a
  local clone). Across a 113-task sweep repos repeat, so this also removes
  hours of wall-clock and most of the rate-limit exposure.
- Acceptance: kill the network mid-sweep and confirm the task retries and
  succeeds rather than recording a 0s failure; confirm a second task on the
  same repo does not re-clone from the network.

**T1.2 Flake-aware p2p grading — implemented.**
vulture failed on one p2p test with `f2p 24/24`, and the failing test **differs
between runs** — a flake signature, not a pre-existing failure.
- After an eligible graded run, run one full confirmation verifier pass in the
  same project tree. A p2p failure is confirmed only when the same test fails
  in both runs; otherwise record it as flaky in the verdict/metrics.
- This is deliberately NOT the cached-baseline design (see §4) — it needs no
  persisted state and cannot be poisoned.
- Acceptance: a task whose only p2p failure passes on re-run scores as a pass,
  with the flake named in the verdict.

**T1.3 Run the verifier under Docker — implemented.**
The local verifier shares the host network namespace and a host venv — the root
cause of both the `:8080` collision and the pyarrow drift that needed per-task
repairs. `useDocker` is plumbed through the benchmark runner; enabling it
removes that whole class of false zeros and makes the
per-task overrides in §4 largely unnecessary.
- Acceptance: anko passes its p2p suite with **no** environment override
  applied.

**T1.4 Serialize scoring runs.**
All three clone failures and two of the opus timeouts coincided with a codex
session loading the machine. Scoring runs must not share the box with other
heavy work. Make this a documented pre-flight step, not a hope.

### Tier 2 — convert the near-misses (real capability, +1–2)

**T2.1 Replace the inert marker gate with exactness guidance and patch audit —
implemented.** The evidence rejected the old contract. Across all eight
completed repetitions of opus run `99927e3e` and the ox-alpha smoke run,
`specgate_throwaway_paths_removed` was `0` every time;
`graded_patch_test_paths` was `0` in seven of the eight opus repetitions. The
one informative exception was an anko repetition that added one test file
without the requested marker. Both models could add tests, but neither followed
the marker convention, so marker-based stripping offered no measured defence
against leftover tests.

The `omega_specgate` convention and its stripping machinery are removed. Patch
capture now preserves the complete patch; the harness never rewrites a model's
submission based on a filename convention. Instead, it detects test-like paths
that are present in the graded patch and which of those paths were absent from
the base commit. Evaluations expose `graded_patch_test_paths`,
`graded_patch_added_test_paths`, and the bounded
`graded_patch_added_test_path_list`; newly added test-like paths are also
disclosed prominently in the evaluation message. These are audit signals, not
reward inputs. They make the leftover-test hazard visible without pretending
the harness can infer whether a model-authored test is disposable or required.
The historical `specgate_throwaway_paths_removed` metric is no longer emitted.

The prompt treatment is now one compact `EXACTNESS CHECK` immediately adjacent
to the public task specification; the old multi-step test-writing ritual and
ordered workflow are gone. It asks the model to checklist exact strings,
names, signatures, defaults, boundaries, invalid inputs, and output/file
formats, then verify exact text character-for-character rather than by
substring. This is aimed directly at the stable anko miss: the required parse error was
`invalid default argument declaration`, while both models emitted `syntax
error`. It does not disclose `f2p_node_ids`, `tests/config.json`,
`tests/test.patch`, or any hidden-test detail.

`OMEGA_DEEPSWE_SPEC_GATE` still controls this exactness treatment and defaults
**on**. Values `0`, `false`, `off`, or `no`, in any letter case, disable it, so
the smaller intervention remains A/B-able. At a configured 20- or 30-minute
budget, anko's generated description is 2,746 characters: 873 characters of
cleaned public task text and **1,873 characters of boilerplate**, down by 536
from 2,409 after the BUILD GATE restore.

**T2.2 Tell the agent its time budget — implemented with total time.**
sol wall-clocked all 8 tasks (1809–1998s at a 1800s cap) while opus finished in
400–1200s. A model that knows its deadline can prioritize; one that doesn't
burns the budget exploring. Every DeepSWE description now states the configured
wall-clock budget, tells the agent to get the new behavior working first, and
names 60% of the budget as the point to stop exploring and begin existing-suite
verification and regression repair. The internal executor now derives its
deadline from that configured timeout, and external CLI retries share one
absolute deadline instead of receiving a fresh timeout per process. The
internal guard interrupts in-flight provider calls, shell commands, and final
validation while still capturing the complete terminal patch. Internal
late-step notices report both steps and wall-clock time remaining; external CLI
prompts include their UTC launch time and absolute UTC deadline, so either path
can observe the unit used by the guidance.

`OMEGA_DEEPSWE_TIME_BUDGET` independently controls this prompt block and accepts
the same case-insensitive off values (`0|false|off|no`). With both prompt
switches off, the complete task description is byte-for-byte the pre-Tier-2
prompt, and neither the external deadline notice nor the enhanced internal
late-step notice is injected; this is the clean 4/8-baseline control.

### Tier 3 — stop the number lying (no true-score change)

**T3.1 Use n=1 for iteration and n ≥ 3 for scoring claims — variance plumbing
implemented; pass@k reporting remains.** The earlier case for making every run
n ≥ 3 came from pre-Docker flips, including returns-validated changing between
`f2p 0/159` and `159/159`. Run `99927e3e` supplies better-matched evidence under
Docker:

- anko completed 3/3 byte-identical repetitions at f2p `1/2`, p2p `119/119`,
  partial `0.9917355371900827`;
- abs completed 3/3 passes at f2p `6/6`;
- narwhals completed one repetition that exactly reproduced the earlier n=1
  outcome, f2p `98/103` and p2p `9752/10093`.

That is **exactly seven completed repetitions across three tasks, one model,
and one environment**. The observed outcomes are deterministic and suggest the
old variance was environmental rather than model nondeterminism. It is not a
proof about the full 113-task corpus, another model, or another environment.

Therefore n=1 is the default for iteration in the HTTP schema, runner, CLI, and
web form. Use n ≥ 3 for a final scoring claim, or earlier for any task whose
outcome has actually been shown to vary. For that final mode, request
`"strategy": "variance", "varianceRuns": 3`; the HTTP schema preserves the
run count, and each task is attempted three times. The existing task-level
verdict deliberately remains a majority collapse (`passRate >= 0.5`) and the
top-level `harnessTaskId` remains the last repetition for compatibility.
Aggregate `passRate`, `passes`, and `nRuns` are retained, and
`variance_run_outcomes` now records a compact ordered JSON array containing
each repetition's run number, harness task id, pass/fail result, score when
present, duration, and numeric evaluator metrics. String-valued output and log
fields are omitted from that repeated array; the aggregate task row still
carries the latest completed repetition's score and bounded metrics so the
Benchmarks tab can show partial reward and verifier detail in variance mode.
Aggregate pass/fail and pass-rate fields still describe the whole requested
series. The JSON string is kept parseable within the shared 2,048-character
history metric budget, omitting the oldest outcomes with an explicit count when
necessary.
`nRuns` remains the requested count. If cancellation or a setup/provider error
ends the series early, `completedRuns` records the number of non-cancelled
outcomes retained, and `variance_incomplete: 1` makes the short series explicit.
For compatibility, the existing `passRate` and majority verdict keep the
requested `nRuns` as their denominator, so an uncompleted repetition still
counts against the aggregate; `completedPassRate` separately reports passes
among non-cancelled recorded outcomes. A
repetition error is retained as a failed outcome with a bounded error summary,
after which the series stops to avoid multiplying a potentially terminal
failure. Cancellation is retained as an explicit `cancelled: true` outcome and
`variance_cancelled: 1`, and it is not inferred to be a timeout.

The top-level `timeouts` field now infers a variance timeout from each
non-cancelled attempt's duration rather than from the cumulative duration of the
whole variance task. Strategies without that task-level `timedOut` result retain
the overall duration-threshold fallback. Older variance rows accumulated the
durations of multiple repetitions and could therefore be labelled as timeouts
even when no attempt timed out; historical variance `timeouts` values are not
comparable across this change.

The named quick-signal set is **`deepswe-fast-signal`**. This is a runbook name,
not a new suite enum: invoke the `deepswe` suite with task IDs
`abs-stepped-slices` and `anko-default-function-arguments`. They are the cheap
pair in the measured runs. For an exact common reference, their persisted
source rows in run `4e8be75d` took 466,853 ms (7m47s) and 642,175 ms (10m42s),
respectively. Exclude `sqlfmt-create-table-ddl-formatting` at 1,816,356 ms
(30m16s) and `narwhals-rolling-window-suite` at 1,911,072 ms (31m51s; roughly
34 minutes in the follow-up data) from this iteration loop. Host load moves the
absolute figures, but not the choice of the cheap pair.

The remaining T3.1 work is to calculate and render pass@k from those outcomes
at the run/model level, with confidence intervals, rather than treating the
majority verdict as the whole statistical report.

**T3.2 Track partial reward as a secondary metric — implemented.** abs scored
`partial 0.917` — real progress a binary hides. DeepSWE task rows on the
Benchmarks tab now show partial reward, f2p/p2p counts, verifier mode, and
flake-rerun disclosures. Partial remains a neutral numeric progress measure. A
failed task is labelled a near miss only when it has a valid f2p denominator and
completed at least half of the requested fail-to-pass work
(`f2p_passed / f2p_total >= 0.5`); the p2p-dominated partial score does not drive
the badge.

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
- **Cancellation is terminal but auditable.** The runner now writes the
  completed/cancelled task outcomes to `BenchmarkHistory`; a variance
  repetition is marked `cancelled: true` and `variance_cancelled: 1` rather than
  disappearing or masquerading as a timeout. Unstarted tasks still have no
  per-task result.
- **An orphaned `running` run blocks new ones** (`A benchmark run is already in
  progress`) — cancel it via `POST /bench/run/:id/cancel` first.
- **`deepswe.taskIds` vs top-level `taskIds`**: both are accepted by the
  schema. Nested wins now (fixed), but a 2-task request once launched all 113.
- **Bench work happens in a worktree**, not the project dir
  (`${OMEGA_STORAGE_ROOT:-~/.omega}/work/worktrees/<project>-<taskid>`).
  Looking at the project path and seeing an empty `src/` means nothing.

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
- T1.1/T1.2 (`db5d7ec`) — retrying bare-mirror clone cache plus bounded,
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

## 6. Runbook: quick signal, replay, golden check, and final sweep

```bash
# 1. exclusive-host pre-flight (run before every model-scored sweep)
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

# 2. iteration: deepswe-fast-signal, one attempt of the two cheap tasks
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "models": [{"provider": "external:claude-code", "model": "claude-opus-5"}],
  "strategy": "single",
  "concurrency": 1, "timeoutMs": 1200000,
  "projectPrefix": "deepswe-fast-signal",
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "taskIds": ["abs-stepped-slices","anko-default-function-arguments"],
    "useDocker": true
  }
}'

# 3. final scoring claim: n>=3, serialized, 30 minutes per attempt because
# this set includes sqlfmt and narwhals
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "models": [{"provider": "external:claude-code", "model": "claude-opus-5"}],
  "strategy": "variance", "varianceRuns": 3,
  "concurrency": 1, "timeoutMs": 1800000,
  "projectPrefix": "score-run",
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "taskIds": ["abs-stepped-slices","anko-default-function-arguments","sqlfmt-create-table-ddl-formatting","returns-validated-error-accumulation","sqlite-utils-safe-import-checkpoints","vulture-persistent-analysis-cache","narwhals-rolling-window-suite","psd-tools-blend-range-api"],
    "useDocker": true
  }
}'

# 4. verifier-only replay of a stored run (no models/provider call)
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "replay": {"fromRunId": "<source-benchmark-run-id>"},
  "concurrency": 1, "timeoutMs": 1800000,
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "useDocker": true
  }
}'

# Or replay explicit source tasks instead of a whole run.
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "replay": {"fromHarnessTaskIds": ["<source-harness-task-id>"]},
  "concurrency": 1, "timeoutMs": 1800000,
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "useDocker": true
  }
}'

# 5. verifier-only golden grading regression (all four, then one fixture)
pnpm bench:deepswe:golden
pnpm bench:deepswe:golden -- --task abs-stepped-slices

# 6. watch API runs; results land in BenchmarkHistory and the Benchmarks tab
curl -s http://localhost:4000/bench/run/<id>
curl -s http://localhost:4000/foreman/benchmarks
# Use an id from the aggregate response's `recent` array to fetch its bounded
# per-task evaluation detail only when needed.
curl -s http://localhost:4000/foreman/benchmarks/<benchmark-history-id>
```

The exactness check and time guidance default on and are independently
controlled by the legacy-named
`OMEGA_DEEPSWE_SPEC_GATE` and `OMEGA_DEEPSWE_TIME_BUDGET`. Either accepts
case-insensitive `0|false|off|no`. Record both settings with the run. Turning
only one off isolates that experiment; turning both off reproduces the complete
pre-Tier-2 task prompt byte for byte, including no dynamic external deadline and
the legacy internal step-only late-budget notice. It is the control comparable
to the 4/8 baseline. `OMEGA_DEEPSWE_SPEC_GATE` no longer enables filename
markers or patch stripping; it controls only the compact exactness prompt.

Variance mode runs each task `varianceRuns` times. With the serialized example
above, plan for up to 90 minutes of agent time per task before setup and
verification overhead; the individual attempt limit remains 30 minutes.
Iteration requests should leave the default at n=1. Replays and golden checks
exercise setup plus verification only and must not be counted as model samples.

Verifier artifacts (the ground truth for any claim about a score):
`${OMEGA_STORAGE_ROOT:-~/.omega}/work/deepswe/<task>-<timestamp>/verifier.log`
— contains the `reward.json` line and the per-test
`[verifier] ✗ [f2p|p2p]` failures.

### How to audit the exactness experiment and patch integrity

Read these signals in this order on the next matched sweep:

1. Timeout count first: the pre-Tier-2 baseline was **2/8**. A correctness gain
   bought by more timeouts is not a clean gain.
2. `p2p_passed/p2p_total` on sqlfmt and narwhals. Sqlfmt's reference is
   **1248/1273** (narwhals was 9752/10093); a compile-breaking leftover can turn
   a strong partial result into missing/failed package results.
3. The `apply_failed` rate, plus any task that drops to `f2p 0` while carrying a
   non-trivial patch. Treat either as a harness/prompt regression until disproved.
4. `graded_patch_test_paths`, `graded_patch_added_test_paths`, and
   `graded_patch_added_test_path_list`. Inspect every newly added test-like path;
   the harness discloses it but deliberately leaves the full patch unchanged.
5. Run `pnpm bench:deepswe:golden` before and after a grading change. Any drift
   in the four pinned outcomes requires review; it says nothing by itself about
   whether a model got better.

### Clone and flake safeguards

DeepSWE clones use a retrying, atomic bare-mirror cache under Omega's work
directory. Override its location with `OMEGA_DEEPSWE_REPO_CACHE_DIR`, or set
`OMEGA_DEEPSWE_DISABLE_REPO_CACHE=1` to use the retrying direct-clone path.
These are full Git mirrors: the corpus currently has 92 distinct repository
URLs, so inspect `df -h` before a sweep. Measured, not estimated: the eight
scoring-set repos cost **96 MB of mirror in total** (run `4e8be75d`) — far less
than feared. Do not extrapolate that to 92 linearly, though; the scoring set is
all small repos and the corpus also contains langchain, fastapi, numba, helm,
opa and ipython. A new
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

### narwhals: an environment defect was eating a genuine solve — FIXED 2026-08-25

Found in 195 seconds with an empty-patch replay, after being hidden behind
34-minute model runs.

Grading the task against a **pristine tree** (empty `model.patch`) reported
`p2p 9752/10093` — **341 pre-existing failures**. The graded opus run reported
the same `9752/10093`, and the two failing sets were **identical**: none caused
by the model. Since `reward=1` needs every p2p test, narwhals was a guaranteed
zero for every model on every Docker run.

Root cause: the image ships **pyarrow 25.0.1**, whose
`Specifying null_placement in SortOptions is deprecated` FutureWarning is
promoted to an error by narwhals' `filterwarnings=error`. `EXTRA_TASK_DEPS`
already carried the correct `pyarrow>=23,<25` pin with exactly that reasoning —
but `runDeepSWEVerifierDocker` never applied pip overrides, so enabling Docker
(T1.3) silently dropped a repair the local path had. §1b's "zero environment
overrides were applied" was true, and for narwhals that was the bug.

**The fix**: apply the task's pip pin inside the container before `test.sh`.
The install is gated with `&&` on purpose — grading with the wrong pin is what
produced the false zeros, so a failed pin must not quietly grade anyway — and
the container output lands in `verifier.log` so a failure stays legible. The
Docker path now also reports the pin through the normal
`appliedEnvironmentOverrides` disclosure instead of hard-coding an empty list.

**The result is bigger than a repaired environment.** Replaying opus's *stored*
patch with the pin applied:

```
narwhals-rolling-window-suite  passed=true  f2p=103/103  p2p=10093/10093
```

The patch was **correct all along**. Not only were the 341 p2p failures not the
model's, so were the 5 missing f2p tests. The task was scored 0 on work that had
actually solved it, which means **the post-Tier-1 shakedown was really 5/8, not
4/8** (§1b), and the achievable maximum is 8 — the earlier "max 7" note was
wrong.

Two corrections to earlier claims in this document, both mine:

- An earlier revision said the pin could not be installed in-container because
  `pyarrow<25` "has no wheel for this architecture and builds from source,
  exceeding 10 minutes per run". That was **wrong**. The link was throttled at
  the time; on a healthy connection the wheel installs in **62 seconds**
  (`Successfully installed pyarrow-24.0.0`). Beware diagnosing a slow network as
  a missing wheel.
- The same revision advised treating narwhals as excluded. It is now scoreable.

Cost: the pin adds ~60s to each narwhals grading run. The golden replay of the
full corpus went from 133.7s to 344.3s, most of it narwhals now actually
running its whole 10,093-test suite instead of failing 341 of them early.

### The empty-patch baseline — the safe version of a rejected idea

The technique that found the above is worth keeping. Grading an **empty patch**
in a **pristine container** measures what the environment does with no model
involved. Across the scoring set it takes seconds, and it gives exactly the
"which p2p tests fail on a clean tree" signal that §4's baseline-grading design
wanted — but computed in a throwaway container rather than in the agent's tree,
which is precisely the safe construction §4 said would be required. It is a
diagnostic, not a grading input: nothing here excludes a test from scoring.

Measured 2026-08-25, empty patch, Docker (`p2p passed/total`):

| Task | Baseline | Verdict |
|---|---|---|
| abs-stepped-slices | 6/6 | clean |
| anko-default-function-arguments | 119/119 | clean |
| sqlfmt-create-table-ddl-formatting | 1273/1273 | clean — so opus's 1248/1273 was **real** regression damage |
| returns-validated-error-accumulation | 61/61 | clean |
| sqlite-utils-safe-import-checkpoints | 1038/1038 | clean |
| vulture-persistent-analysis-cache | 295/295 | clean — the rotating flake does not occur under Docker |
| psd-tools-blend-range-api | 979/979 | clean |
| narwhals-rolling-window-suite | 9752/10093 → **10093/10093** | was broken; clean since the pin fix above |

Run one before trusting any new task, and before blaming a model for p2p
damage: 341 of them turned out not to be the model's fault — and repairing that
turned a scored zero into a pass.

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

On a fresh machine, start with [DEEPSWE-QUICKSTART.md](DEEPSWE-QUICKSTART.md)
(`task setup`, `task deep-swe:golden`) — it verifies the whole grading
pipeline in ~5 minutes with no model spend.

Start with the verifier-only loop: run `pnpm bench:deepswe:golden` after any
grading change, or use `replay.fromRunId` / `replay.fromHarnessTaskIds` when the
patch of interest is already in the database. Neither result belongs in a model
comparison; filter replay rows using `replay: 1`.

For a prompt, runner, or model change, run the two-task
`deepswe-fast-signal` set serialized under Docker at n=1. Escalate to the full
eight-task set only after that signal is useful. Reserve
`strategy: "variance", "varianceRuns": 3` for the final scoring claim or for a
task that demonstrates non-determinism. Treat the first full run with the new
exactness treatment as a new post-Tier-2 series; do not compare its headline
directly with the pre-treatment 4/8 baseline.

Continue to watch:

- any `flake_forgiven_pass: 1` row — audit `p2p_rerun_failure_disjoint` first
  and read both verifier logs (§6);
- the same-tree re-run's second `git apply` of the stored patch. Its
  precondition (`removePatchPathsMissingFromBase`) is unit-tested in isolation,
  but no test drives the local verifier twice end to end;
- every non-zero `graded_patch_added_test_paths` count and its bounded path
  list. The patch remains intact, so this is disclosure for review, not an
  automatic exclusion.

Keep the prompt-switch value, timeout, host pre-flight, and per-run variance
outcomes with every result so later comparisons do not conflate prompt effects
with scheduling noise.
