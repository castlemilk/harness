# DeepSWE benchmarking on a fresh machine

The 10-minute path from `git clone` to a verified grading pipeline, then how to
run a real sweep. The full methodology, history, and gotchas live in
[DEEPSWE-SCORING-PLAN.md](DEEPSWE-SCORING-PLAN.md) — this page is only the
setup and the commands.

## What you need

- **Node >= 20 and pnpm 10.x** (`corepack enable` gets you the pinned pnpm)
- **Docker** running (verifier containers; the adapter builds missing task
  images on demand, but warming them first keeps builds out of timed runs)
- **~2 GB disk** for mirrors + checkouts (more if you run the whole
  117-task corpus — its repos include langchain, fastapi, numba, helm)
- **A model path** — see "Models" below
- macOS/Linux. Everything is local-first: SQLite (PGlite) under
  `$OMEGA_STORAGE_ROOT` (default `~/.omega`), no external DB to provision.

## Setup

```bash
git clone --recursive https://github.com/castlemilk/harness.git
cd harness
task setup          # submodule init (done by --recursive), install, migrate
cp .env.example .env   # then edit: see below
task deep-swe:images   # warm the 8 scoring-set verifier images (optional but nice)
```

If you cloned without `--recursive`: `git submodule update --init deep-swe`.

### The `.env` bits that matter for benchmarking

Everything has a working default; the two you are most likely to touch:

- `OMEGA_STORAGE_ROOT` — all runtime data (DB, worktrees, mirrors). Point it
  at a volume with room if your home disk is tight.
- `OMEGA_DEEPSWE_REPO_CACHE_DIR` — the repo mirror cache (default: under the
  storage root). The scoring set costs ~96 MB of mirrors.

Provider keys are only needed for the models you actually use. The two prompt
switches (`OMEGA_DEEPSWE_SPEC_GATE`, `OMEGA_DEEPSWE_TIME_BUDGET`) default on
and must be held constant across any runs you intend to compare.

## Verify the machine: golden replay (no model, no cost)

```bash
task dev             # API on :4000 in one terminal (Ctrl-C when done)
task deep-swe:golden # other terminal
```

This re-grades four stored golden patches through the real Docker verifiers
and diffs against recorded outcomes — ~5 minutes, $0, and it exercises the
submodule, image building, cloning, patch application, grading, and the flake
gate. **Exit 0 = the grading pipeline is intact.** A mismatch means grading
drifted, and any sweep you ran after the drift is suspect.

## Models

Two proven paths:

1. **External CLI (recommended for benchmarking).**
   `"provider": "external:opencode", "model": "opencode-go/ox-alpha-free"`
   after one `opencode login` on the machine — free, and the external path
   does **not** inject stored solution skills. `external:claude-code` /
   `claude-opus-5` likewise uses the CLI's own auth.
2. **Internal providers** (OpenAI-compatible etc. via `.env` keys). Caveat:
   the internal agent loop applies stored solution patches from
   `.agents/skills` for 3 of the 8 scoring tasks and marks them passed
   without model work unless `OMEGA_SKILL_VERIFY=true`. Fine for harness
   development; do not score DeepSWE through it.

## First real run

```bash
task deep-swe:smoke   # one cheap task, end to end, ~10 min
```

Then the full scoring set (serialized, Docker, 30-min budgets — the plan's §7
recipe, ~4h wall clock):

```bash
curl -s -X POST http://localhost:4000/bench/run -H 'Content-Type: application/json' -d '{
  "suite": "deepswe",
  "models": [{"provider": "external:opencode", "model": "opencode-go/ox-alpha-free"}],
  "strategy": "single", "concurrency": 1, "timeoutMs": 1800000,
  "projectPrefix": "scoring",
  "deepswe": {
    "tasksDir": "'"$PWD"'/deep-swe/tasks",
    "taskIds": ["abs-stepped-slices","anko-default-function-arguments","sqlfmt-create-table-ddl-formatting","returns-validated-error-accumulation","sqlite-utils-safe-import-checkpoints","vulture-persistent-analysis-cache","narwhals-rolling-window-suite","psd-tools-blend-range-api"],
    "useDocker": true
  }
}'
```

Watch progress: `curl -s localhost:4000/bench/run | python3 -m json.tool`,
or the Benchmarks tab in the web UI (`task ui`). Per-task f2p/p2p detail,
verifier mode, and flake disclosures are served from
`GET /bench/run/:id` — no log grepping required.

## Before you quote a number

The plan's rules that most often bite (§1b/§1c have the war stories):

1. **Host pre-flight** — 1-minute load under the logical CPU count, no other
   Docker stacks or agent sessions running. Three of four misses in the last
   sweep were timeout cuts on a contended box.
2. **`concurrency: 1`** for anything you intend to compare.
3. **n=1 first**, `strategy: "variance", "varianceRuns": 3` only for a final
   claim or a task that demonstrates non-determinism.
4. **Run the golden replay after any grading-side change** — it is the
   circuit breaker between "grading drifted" and "the model got worse".

## Reference scores on this corpus state

All n=1, Docker, corrected grading, 30-min budgets (§1b/§1c of the plan):

| Model | Score |
|---|---|
| claude-opus-5 | 5/8 |
| ox-alpha-free | 4/8 |

Do not compare numbers across prompt-switch settings or corpus pins.
