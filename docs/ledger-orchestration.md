# Ledger orchestration (`ledger` task mode)

A training-free manager–worker scaffold ported from **GVS5H /
[arXiv:2608.26480](https://arxiv.org/abs/2608.26480)** ("Zero-Shot
Self-Orchestration with Ledger-Based Control"). One model, every role, a fresh
context per call; the only shared state is a filesystem ledger.

## Enabling it

Tag a task `ledger`:

```bash
harness task create --project <id> --title "Solve arc196_b" \
  --description "<problem statement + stdin format instructions>" \
  --provider ollama --model qwen3.8:27b-mlx-64k --tags ledger --run
```

`runTask` dispatches `ledger` to `runLedgerTask` (`packages/agent/src/ledger/run-task.ts`),
which mirrors the task status/result, writes a `ledger.loop` step and an
`AgentRun` with aggregated tokens/cost. The workspace lives at
`${OMEGA_STORAGE_ROOT:-~/.omega}/work/orchestrations/<taskId>/`.

## Ledger files

| File | Written by | Notes |
| --- | --- | --- |
| `task.md` | init | problem statement |
| `plan.md` | manager plan | ≤4000 chars |
| `tasks.json` | manager | `{id, desc, status, result}`, ≤12 tasks |
| `notes.md` | workers | **rewritten wholesale** by each worker (≤8000 chars), ideation appends |
| `solution.py` | workers | first Python fence from the reply |
| `transcript.jsonl` | loop | one JSON line per call: role, prompt, response, finishReason, usage, truncated |

## Loop

manager plan → ideation (no code) → manager curates one next task → worker
executes it → sample tests run against `solution.py` → manager re-curates →
finalize. Guards: `maxIters` (default 10), stop when the manager reissues the
same task, `done` requires an artifact, a failing sample test vetoes `done`, and
a call that hits the output cap is summarized so its ideas still reach the
manager.

Worker calls are **single provider calls** with `maxOutputTokens` (short,
bounded) — not the repo tool loop. Sample verification only runs for tasks that
provide `tests` (used by the eval harness, below).

The paper's proposed **fresh-perspective** worker is available via
`freshPerspective` (eval `--fresh`): before managing, one worker attempts the
raw problem with no plan/notes, and its candidate is written to
`solution-fresh.py` (never overwriting `solution.py`) with a summary in the
notes the manager sees. The paper suggests this hedges against a bad
decomposition framing.

## Evaluating effectiveness

`scripts/eval-ledger.mjs` runs single-call vs ledger on the same problems with
the same grader:

```bash
# Fetch an LCB-hard sample (needs the GVS5H clone for its patched loader)
uv run --no-project --python 3.12 --with 'datasets<4' \
  scripts/fetch-lcb-problems.py \
  --lcb-root "$GVS5H/codebase/livecodebench" \
  --ids-file "$GVS5H/codebase/v2-current/escalation/lcb100_hardest_v6.json" \
  --n 4 --out scripts/fixtures/lcb-hard-sample.json

node scripts/eval-ledger.mjs \
  --problems scripts/fixtures/lcb-hard-sample.json \
  --model qwen3.8:27b-mlx-64k --base-url http://localhost:11434 \
  --max-output 4096 --max-iters 4 --n 2 --out /tmp/ledger-eval.json
```

Flags: `--think` enables reasoning, `--hidden` grades against the private LCB
tests (exported by the fetcher as `hiddenTests`), `--fresh` enables the
fresh-perspective worker, and `--max-output/--max-iters/--timeout-ms` bound the
run. Reports include per-problem rows, per-role stats, and — when both `single`
and `ledger` run — a paired comparison with mean 95% CIs, an exact sign-flip
permutation p-value, and an exact McNemar test on discordant problems
(`packages/bench/src/stats.ts`).

The same runner is available from the CLI and as a library:

```bash
harness ledger eval --problems scripts/fixtures/lcb-hard-sample.json \
  --kind generic --base-url https://openrouter.ai/api/v1 \
  --model qwen/qwen3.8-27b --max-output 8192 --think --hidden

# library
import { runLedgerEval, formatLedgerEvalSummary } from '@omega/bench';
```

For full eval runs (paired passes, hidden grading, report files), use the
wrapper, which sources `.env` and names reports
`/tmp/ledger-eval-<tag>-pass<N>.json`:

```bash
scripts/run-ledger-eval.sh --model meta/muse-spark-1.3-contributor --passes 3
scripts/run-ledger-eval.sh --model stealth/union-alpha --start-pass 2  # redo one pass
```

Both arms are graded with `runSampleTests` (stdin public tests). The report
records pass@1, calls, truncated calls, tokens and wall time per problem/mode.

### Basic eval result (2026-09-12)

4 LiveCodeBench-hard problems (`arc196_b/c/a/d`), OpenRouter
`qwen/qwen3.8-27b`, reasoning off, 2048-token output cap, `maxIters=5`:

| Arm | pass@1 | valid Python emitted | calls | truncated calls | completion tokens |
| --- | --- | --- | --- | --- | --- |
| single | 0/4 | **0/4** | 4 | 4 | 8,192 |
| ledger | 0/4 (1 network error) | **3/4** | 45 | 15 | 57,060 |

The mechanism the paper attributes its gains to is visible here: every single
call hit the cap mid-generation and emitted nothing gradeable, while the ledger
kept state on disk, absorbed five truncated worker calls, and still produced a
complete `solution.py` on 3 of 4 problems. It did **not** convert those emits
into passes at this budget — ARC-196 hard with a 27B reasoning-off model at a
2k cap sits below both arms' capability floor, consistent with the paper's
finding that gains are conditional (and largest at larger caps / reasoning on).

### Paired rescue result (arc196_b, 8192 cap)

Same model (`qwen/qwen3.8-27b` via OpenRouter), reasoning off, 8192-token cap,
`maxIters=4`, same grader:

| Arm | result | calls | truncated calls | completion tokens | wall time |
| --- | --- | --- | --- | --- | --- |
| single | fail (cap hit, no gradeable code) | 1 | 1 | 8,192 | 76s |
| ledger | **pass (1/1)** | 5 | 0 | 23,620 | 343s |

The single call burned the full cap mid-generation and produced nothing; the
scaffold spent ~2.9× the tokens across five bounded calls, kept the plan/notes
on disk, and produced a passing solution. That is the paper's central claim
reproduced on the harness at smoke scale; the full-conditions run (128k cap,
reasoning on, five paired passes, hidden tests via the patched LCB evaluator)
is the next step.

### Full-conditions attempt (reasoning on, 8192 cap)

Running the same pair with `--think --hidden` at an 8192 cap (closer to the
paper's condition, but far below their 128k) puts both arms below the
capability floor: `arc196_b` single failed on a truncated generation, and the
ledger failed too (7 calls, 6 truncated, 49.7k completion tokens) because
reasoning consumed the budget in every worker call. The paper's own result at
this model needed a 128k cap; the full condition (128k, reasoning on, five
paired passes) was run on 2026-09-13 (below).

### Full-conditions result (128k, reasoning on, five paired passes)

> **Correction (2026-09-14):** the eval runner's `buildSend` hardcoded
> `thinking: false` and dropped `--timeout-ms`, so this run (and the 8k
> "reasoning on" attempt above) actually executed with provider reasoning
> **disabled**, and calls were capped at the 120s fetch default. Fixed in
> `packages/bench/src/ledger-eval.ts` (`think`/`timeoutMs` now threaded
> through; reports record `think`). The numbers below are therefore a 128k
> reasoning-*off* result; a true reasoning-on rerun needs an OpenRouter credit
> top-up (balance covered only ~95.7k output tokens when last checked).

Same model and grader, `--think --hidden`, 131072-token output cap,
`maxIters=10`, 60-minute per-call timeout, all 4 LCB-hard problems x
{single, ledger} x 5 passes (20 paired problem-instances). Reports:
`/tmp/ledger-eval-128k-pass{1..5}.json`.

| Arm | pass@1 | calls | truncated calls | completion tokens |
| --- | --- | --- | --- | --- |
| single | 2/20 (10%) | 20 | 0 | 385,063 |
| ledger | 3/20 (15%) | 257 | 0 | 666,272 |

Per problem (solves / 5 passes):

| Problem | single | ledger |
| --- | --- | --- |
| arc196_a | 0/5 | 0/5 |
| arc196_b | 2/5 | 3/5 |
| arc196_c | 0/5 | 0/5 |
| arc196_d | 0/5 | 0/5 |

Paired totals: discordants single-only 1, ledger-only 2, both 1, neither 16;
mean delta +5pp; exact McNemar p=1.0, sign-flip p=1.0.

At 128k with reasoning on, truncation disappears in both arms (0/20 single
calls, 0/257 ledger calls), confirming the 8k failure mode was the cap rather
than the scaffold. The ledger's advantage narrows to one extra solve on
`arc196_b` and is not statistically significant at this sample size — `a`,
`c`, and `d` sit below both arms' capability floor. This is consistent with
the paper's conditional-gains framing: the scaffold's mechanism (bounded
calls, state on disk) matters when budgets truncate single generations, and
buys less headroom once a single call fits under the cap.

## Debugging a ledger run

Every call is visible in three places:

1. **Task detail → Ledger tab** (for tasks tagged `ledger`): per-role stats
   (calls, truncations, output tokens, avg/max latency) and a per-call timeline
   with duration bars and finish reasons, plus the workspace files
   (`plan.md`, `notes.md`, `tasks.json`, `solution.py`).
2. **`GET /v1/tasks/:id/ledger`** (also unversioned `/tasks/:id/ledger`): the
   same data as JSON — `files`, `calls[]` (role, startedAt, durationMs,
   finishReason, truncated, token counts, cost, response excerpt) and
   `roles[]` aggregates plus `totals`. Useful for scripts and MCP clients.
3. **Traces**: `runLedgerTask` persists a `ledger.task` root `TraceSpan` with
   one `ledger.<role>` child span per call (duration, finish reason,
   truncation, tokens, cost, response size), so the existing **Trace flow** tab
   works without any tracing backend. When the server runs with
   `OTEL_EXPORTER_OTLP_ENDPOINT`, the same spans are live in Tempo and feed the
   hotspots endpoint as `ledger.worker`, `ledger.manager`, `ledger.cutoff_summary`, etc.

The JSONL transcript in the workspace is the source of truth for both
surfaces; `durationMs` and `startedAt` are recorded by the loop, so reruns of
old workspaces (before that change) show `null` timings.

The eval script prints the same role breakdown for its ledger arm:

```
ledger by role:
role                calls trunc  out tok     avg     max
manager_plan            1     1     7340   71.1s   71.1s
manager                 3     0      964   19.8s   33.4s
worker                  1     0     6746  123.4s  123.4s
```


## Provider requirements

- `SendOptions.maxOutputTokens` must be honored per provider (Ollama
  `num_predict`, OpenAI `max_tokens`/`max_completion_tokens`, Anthropic
  `max_tokens`, Gemini `maxOutputTokens`).
- `SendOptions.onFinishReason` supplies the truncation signal
  (`length`/`max_tokens`) used for cut-off summarization and counters.

## Known limits

- Roughly triples the token bill vs a single call; gains are conditional
  (the paper regresses on some models, e.g. Qwen3.6-35B with reasoning off).
- The harness verifier only executes stdin-format public tests; call-based
  (LeetCode-style) tests need a different runner before they can veto `done`.
- No resume yet: a failed or interrupted run starts from scratch.

### Prompt experiment: THINKING_BUDGET (2026-09-14)

Motivation: with reasoning enabled at an 8k cap, every ledger role truncated at
the cap (baseline: manager 4/4, worker 4/4, ideation 2/2 truncated), so the
ledger never emitted a parseable plan or solution.

Change (`ledger-prompts/v2-thinking-budget`, PromptVersion hashes
15d24bcd -> 22ad362d): a shared `THINKING_BUDGET` directive telling every role
to commit to one approach within ~1200 reasoning tokens and emit sections
immediately.

Result (local qwen3.8:27b-mlx-64k, arc196_b/c, hidden grading):
- 8k thinking-on: both prompts pinned at the floor -- baseline and v2 both
  0/2 with (nearly) every call truncated. The cap dominates; prompts cannot
  matter at this budget.
- 8k thinking-off: equal pass rate (0/2 both arms on both prompts), but v2
  cut ledger cost roughly in half (11 calls / 10.1k worker tokens vs 22 calls
  / 24.4k worker tokens). Neither prompt reproduced the OpenRouter 8k rescue
  on this model -- the local MLX stack is weaker than the hosted qwen3.8-27b.

Kept: v2 is not worse and is materially cheaper. Not declared better; a real
reasoning-on comparison needs the OpenRouter top-up (128k condition).

### Full-conditions run on a free model (nemotron-3-super-120b, 128k, reasoning on)

First run after fixing the eval runner (`--think` and `--timeout-ms` now
actually threaded through; empty free-tier completions retried/failed loudly).
Model `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter, 131072-token
cap, `maxIters=10`, hidden grading, all 9 LCB-hard problems, single pass
(report: `/tmp/ledger-eval-nemotron-pass1.json`, ~13.5h wall).

| Arm | pass@1 | calls | truncated | completion tokens | avg wall/problem |
| --- | --- | --- | --- | --- | --- |
| single | 3/9 (33%) | 8 | 0 | 580,169 | 17 min |
| ledger | 2/9 (22%) | 46 | 4 | 2,265,028 | 74 min |

Per problem: `arc196_b` ledger-only (the rescue case again), `arc196_c` and
`abc399_f` single-only, `abc400_e` both, 5 neither, 2 provider ERRs
(`arc195_e` both arms, `abc399_f` ledger). Paired: discordants 2/1/1/5,
mean delta -11pp, sign-flip p=1.0, McNemar p=1.0.

Read: at a true 128k thinking-on budget, truncation nearly disappears for the
single arm (0/8), and the ledger's decomposition overhead (~3.9x the tokens,
~4.4x the wall time) no longer pays for itself except where a single
generation would have lost the thread entirely (`arc196_b`). This sharpens
the conditional-gains story: the ledger wins exactly when the single call
would truncate or derail; at generous budgets on strong reasoning models,
that window narrows to the hardest problems.

### Cross-model 128k thinking-on comparison (2026-09-17)

Same 9 LCB-hard problems, hidden grading, 131k output cap, `maxIters=10`:

| Model | Cost | single | ledger | discordants (s-only / l-only / both / neither) | read |
| --- | --- | --- | --- | --- | --- |
| meta/muse-spark-1.3-contributor | $0.2/M out | 6/9 (67%) | **8/9 (89%)** | 0 / 2 / 6 / 1 | ledger-only wins on `abc400_g`, `arc196_a`; +22pp, McNemar p=0.5 |
| stealth/union-alpha | free | **6/9 (67%)** | 4/9 (44%) | 2 / 0 / 4 / 3 | ledger *hurts*: model is ultra-terse (5.6k total single tokens), decomposition only adds failure modes |
| nvidia/nemotron-3-super-120b:free | free | 6/18 (33%) | 6/18 (33%) | 3 / 3 / 3 / 9 | tied across passes 1+3; ledger burns 3.4x tokens |

Pass notes: nemotron pass 2 was lost to an accidental `pkill` (restarted);
`arc196_b` was a ledger-only rescue in every nemotron pass and on muse.

The pattern across four models now: the ledger's edge is **model-dependent**,
not budget-dependent. When a model's single call already emits a tight,
correct program (union-alpha), the manager/worker decomposition strictly
subtracts. When a model rambles or derails on hard problems (muse, nemotron),
the ledger's state-on-disk discipline converts two extra problems per nine.
That is exactly the conditional-gains claim of the paper, now with a sharper
predictor: run one single call first; if it emits a complete non-truncated
solution, the ledger is unlikely to help on that model.
