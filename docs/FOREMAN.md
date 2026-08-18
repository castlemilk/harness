# Foreman

The orchestration layer: an **objective** owns **workstreams**, which own a tree
of **harnesses** (standing agents). Each harness wakes on a heartbeat, runs its
playbook **routine** once, records a **pulse**, and escalates to a human as an
**intervention** when it needs a decision.

## Try it

```bash
task setup          # first run on a fresh checkout
task db:seed:e2e    # load the fixture (21 harnesses, 234 pulses, 3 objectives)
task dev            # API :4000 + web :5173, one database, Ctrl-C stops both
```

`task doctor` if anything looks wrong — it checks databases, migrations, port
occupancy and provider keys.

### Worth clicking

| Where | What it should show |
|---|---|
| **Console** | Tree with a depth-4 chain, an *Unassigned* lane, a paused lane. Roster shows all seven statuses. |
| **Board** | Workstream lanes, 12-pulse sparklines, `+N more` overflow, the *Needs you* rail with all three intervention kinds. |
| **Graph** | Auto-fits the whole fleet. Rings are context used. Drag to pan, `⤢` refits, scrubber replays. |
| **Work / Usage / Playbooks** | Tickets scoped to the objective; spend by model against cap; routine editor with a live resolved preview. |
| **⌘K** | `pause runtime` → acts on the match. `⌘↵` widens to the subtree. |

The second objective ("Keep the support queue at zero") is deliberately empty —
it exists to prove objective-scoping and the empty states. The third ("Demo the
use-case shell") carries `useCase: "demo"`, so selecting it adds a seventh tab.

## Use-case shells

Foreman has **two axes**, and conflating them is what produced the triplicated
view list this replaced.

- The **presentation axis** is the core chrome: Console, Board, Graph, Work,
  Usage, Playbooks. Six views, every objective, always. They are the app.
- The **domain axis** is the *use case*: what an objective is actually for.
  A use case brings extra tabs, an accent, and (eventually) vocabulary — it
  **adds** to the core chrome and can never remove or shadow it.

```
apps/web/src/foreman/usecases/registry.ts     the seam: shells, tabs, resolution
apps/web/src/foreman/usecases/core.tsx        CORE_VIEWS — the six, and their wiring
apps/web/src/foreman/usecases/index.ts        the roster: who is registered, when
apps/web/src/foreman/usecases/demo.tsx        the proof shell (dev/test only)
apps/web/src/foreman/usecases/victoria/       the Victoria trading shell (UC-3)
apps/web/src/foreman/usecases/data-source.ts  how a shell reaches its own backend
apps/web/src/foreman/usecases/health.tsx      probing + the chrome's health dots
apps/web/src/foreman/data/adapt.ts            Foreman's own seam: boundary check
```

`CORE_VIEWS` is the single source of truth for both the tab bar and what
`ForemanApp` renders. `viewTabs(CORE_VIEWS, objective.useCase)` derives the bar;
`resolveViewId` falls back to Console when the active view id doesn't exist on
this objective (switching away from a use-case objective with its own tab open).

**Core views are not a use case**, and are deliberately not modelled as a
reserved shell. They receive `CoreViewContext` — Foreman's internals, including
the focused harness's tools and the playbook draft. A use-case view receives
`UseCaseViewProps`: objective id, state, focus + `onFocus`, `onOpenView`, and
`mutate`. That is the whole plugin surface, and widening it is an API decision.
Registering core views as a fake use case would have forced one of those two
contracts to become the other.

`Objective.useCase` (nullable `TEXT`, lowercase slug, validated identically on
`POST /objectives` and in `registerUseCase`) is the discriminator. Null means
core chrome only, which is what every pre-existing objective is.

The skin seam is one CSS variable, `--uc-accent`, set on the Foreman root from
the active shell's `accent` (stock `#e8963c` without one). Exactly one piece of
core chrome reads it today: the active underline on a use-case tab. Victoria
(UC-3) uses it *inside its own views* — the equity curve's stroke, the loading
pulse — which is the intended way to exploit the seam; resist tinting more of the
core chrome by hand.

### Data sources

A use-case shell usually fronts a backend that is not Foreman's — Victoria's
numbers come from the omega Go API on :8080. A shell **declares** its backends
and **builds its own typed client**:

```ts
const OMEGA = { id: 'omega-api', label: 'Omega API',
                baseUrl: 'http://localhost:8080',
                envVar: 'VITE_UC_VICTORIA_URL',
                probePath: '/api/v1/training/versions' }

const omega = createDataSource(OMEGA)                       // in the shell's module
const portfolio = await omega.postConnect('omega.v1.VictoriaService', 'GetPortfolio')

export const victoria: UseCaseShell = { …, dataSources: [OMEGA] }
```

`createDataSource` gives you `getJson`, `postConnect` (Connect-JSON unary:
`POST /<service>/<method>` with `Connect-Protocol-Version: 1`), `sse` and
`probe` — plain `fetch`, no client codegen, the same shape as
`web/dashboard/src/lib/api.ts` in the omega repo, because that is what the Go
API actually serves. Failures throw a `DataSourceError` carrying the status and
a 400-character body excerpt; run them through `mutate` and they land in the
same error rail as everything else.

**The guest contract stays six fields.** `UseCaseViewProps` does not widen to
carry domain data, ever. A shell's client lives in the shell's own module and
its views import it directly, so Foreman never learns a shell's endpoints,
types or auth. The registry only learns that a source exists.

**Env override convention: `VITE_UC_<ID>_URL`.** When set and non-empty it
replaces `baseUrl`; that is the only supported way to repoint a shell at another
backend. `registerUseCase` rejects duplicate source ids within a shell.

`sse` delivers unnamed frames to `onMessage` by default. A stream that uses
**named** events lists them in `opts.events` and reads `ev.type` to tell them
apart — the omega API's training stream writes `event: connected` then
`event: progress`, neither of which an `onmessage` handler ever sees. The names
stay the caller's to supply; the seam never guesses a shell's event vocabulary.

### Victoria — the trading shell (UC-3)

`usecases/victoria/` is the first real domain plugin. An objective carrying
`useCase: 'victoria'` gets six tabs after the core six, all reading the **omega
Go API on :8080** through the shell's own typed client.

```
victoria/index.ts          the manifest — data only, fetches nothing
victoria/client.ts         typed client: 8 Connect RPCs + 6 REST endpoints + the SSE stream
victoria/hooks.ts          one hook per view, each returning the same Async<T> triple
victoria/geometry.ts       chart maths — pure, React-free, asserted to exact coordinates
victoria/charts.tsx        bespoke SVG: Sparkline, LineChart, HeatGrid
victoria/format.ts         trading formatters (signed money, unclamped pct, regime colour)
victoria/views/            Overview, Runs, Live, Trades, Equity, Signals + shared chrome
```

| Tab | Shows | Reads |
| --- | --- | --- |
| Overview | Portfolio value, cash, exposure, PnL, open positions, equity sparkline, risk grid | `GetPortfolio`, `GetPnL`, `GetPositions`, `GetEquityCurve` |
| Runs | The training-version ledger (586 runs locally), filterable, with a per-run delta against its predecessor | `/api/v1/training/versions`, `/compare` |
| Live | Cycle counter, PnL/win-rate sparklines, regime badge, activity log, event stream | `/api/v1/training/metrics`, `/progress`, SSE `/events/stream` |
| Trades | Blotter with conviction, regime, filters applied — or fills where only the table has rows | `/api/v1/training/trade-details`, `GetTrades` |
| Equity | Full SVG line chart, benchmark overlay, drawdown panel, IS/OOS `train_end` marker | `GetEquityCurve` |
| Signals | Latest sub-signal snapshot + correlation heat grid | `GetSignals`, `/api/v1/signals/correlation` |

**Dependency.** The shell needs `omega-api` running from the omega repo
(`go run ./cmd/omega-api`, port 8080, reads Postgres plus the repo's `data/`
directory). It is not vendored and the harness has no build-time dependency on
it — every type in `client.ts` is hand-derived from
`proto/omega/v1/victoria_service.proto` and `internal/handler/training_handler.go`,
with a provenance comment naming its source. Override the address with
**`VITE_UC_VICTORIA_URL`**. CORS needs nothing: the Go API's default allowlist
(`OMEGA_CORS_ORIGINS`, unset) already contains `http://localhost:5173`, which is
Foreman's dev origin, so no Vite proxy is required.

**Two properties of the wire drive most of the code.** Connect-JSON serialises
fields as lowerCamelCase *and* omits zero-valued ones — `GetPositions` against an
empty database answers `{}`, not `{"positions":[]}`. So every RPC type is fully
optional, "absent" renders as an em dash rather than `0.00`, and every view has a
real empty state. The REST half is Go structs with snake_case tags and means what
it says.

**Known backend defect.** `/api/v1/training/progress` decodes
`data/training_progress.json` into a *struct*, but omega's `run_training.py`
writes a JSON *array* of per-cycle records to that path — so it answers
**HTTP 500** whenever a real run has happened. The Live view treats it as
enrichment over `/metrics` (which is DB-backed and always answers) and renders
the 500 in its own panel with an explanation, rather than catching it and
reporting an idle run that is really a broken endpoint.

**Phase 2, pending backend endpoints** — named so the roadmap stays visible:

- **Gate board** — the six hard gates per run (PnL floor, regime parity,
  drawdown ceiling, trade-count floor, signal integrity, auto-apply audit). The
  data is written to `data/{version}_gate_result.json`; nothing serves it.
- **Conviction funnel** — the four-stage filter pipeline (time filter →
  agreement ratio → weighted conviction → regime/vol gate) with drop counts per
  stage. `/decision-traces` carries the raw per-cycle traces; the funnel
  aggregate does not exist.
- **Forensics diff** — the per-symbol / per-conviction-bucket run comparison
  `omega.tools.forensics.run_diff` produces. `/compare` only returns four scalar
  deltas and a PnL-only verdict.
- **Training-log narrative** — the run's own log as a readable timeline.
- **Richer run rows** — profit factor and max drawdown are in each
  `_results.json` but not in the `/versions` projection, and no endpoint exposes
  the raw file. `sharpe_ratio` is 0 for every row for the same reason (the
  handler reads a key the files do not carry), so the ledger shows an em dash.
- **MAE/MFE per trade** — recorded nowhere today. `sit_out_reason` exists only
  per *cycle* on the progress record, not per trade.

### Backend health

An empty domain tab and a dead backend look identical, so while a shell with
declared sources is active the chrome shows one dot per source next to the
stream indicator — green reachable, red unreachable, dim while probing, with the
label, resolved URL and latency (or error) on hover. Probed on mount and every
30s; **no active shell, or no declared sources, means no timer and no requests**
(`startHealthProbes` is a plain function so that gating is testable without a
renderer). Colours come from the fleet's status palette, so red means the same
thing in the chrome as it does on a harness.

### Where the wire becomes the view model

`types.ts` is both the render model and the wire format — the server serialises
`ObjectiveState` exactly as the shells consume it, so there is no field mapping
to keep in sync. `data/adapt.ts` owns what is left at that seam:

- `projectObjectiveState(wire)` — the boundary check, run on the fetched
  snapshot *and* the SSE `init` frame. It asserts only the load-bearing
  invariants (arrays are arrays, ids are non-empty strings, spend is finite) and
  throws naming the field. It is deliberately not a schema validator: that would
  be `types.ts` in a second dialect, free to drift. A bad SSE frame drops the app
  onto polling instead of rendering `NaN`.
- The projections — `buildTree`, `flattenTree`, `groupByWorkstream`,
  `liveHarnesses` — pure, React-free, testable. `useForeman` re-exports them for
  the existing shells; new code imports from `data/adapt.js`.


## Running it for real

The engine makes **real, paid provider calls**, so it is off unless asked:

```bash
task engine:pulse:dry -- <harnessId>   # no provider call, no spend
task engine:pulse     -- <harnessId>   # one real pulse
task dev:engine                        # scheduler on (FOREMAN_ENGINE=1)
```

A pulse builds its prompt from the harness's mission, routine, recent pulses,
children and any operator reply; calls the provider; then records tokens, cost,
status and any escalation.

Safety properties worth knowing, because they are load-bearing:

- **Budget caps are checked before the call**, so a capped harness cannot
  overspend by one pulse. Hitting the cap raises one budget intervention, not
  one per heartbeat.
- **Unpriced models record `null` cost, never `0`** (`packages/core/src/pricing.ts`).
  A model that looks free would silently defeat every cap.
- **Dry-run harnesses are never auto-run** by the scheduler.
- If no provider serves the harness's declared model, a credentialed provider is
  substituted, the substitution is logged, and **the model that actually ran is
  what cost is attributed to**.

## External agent CLIs

A harness whose model reads `external:<cli>` is driven by a real agent CLI
instead of a chat completion — it works in the objective's project checkout and
produces a diff. Same `external:` convention the task runner already uses.

```
model: external:agy      # also codex, opencode, cursor-cli, claude-code, aider
```

It needs a linked ticket (`taskId`) and a project `path` that exists. Validated
end to end: a harness drove `agy` against a sandbox repo, which implemented the
function, committed it, and recorded the diff against the task.

These CLIs run with permissions skipped and write to the checkout — point them
at a repo you are willing to have modified.

### Usage from external CLIs

Per-run usage comes from the CLI's own structured output, not from any vendor
API — `agy`, `codex`, `claude-code` and `opencode` each have a parser under
`packages/agent/src/*-output.ts` that feeds tokens (and cost, where the CLI
reports it) into the run's `AgentRun`.

agy reports tokens but **not cost**, and its envelope does not name the model,
so an `external:agy` run records usage with cost `null`. Their interactive
`/usage` command is a different thing — account-level quota, fetched with the
credentials each CLI stores (e.g. `~/.codex/auth.json`). Reaching those means
reusing another tool's OAuth token against an undocumented endpoint; prefer the
vendors' official billing APIs if you need account-level spend.

**If a PTY-based CLI fails with `posix_spawnp failed`**, node-pty's
`spawn-helper` has lost its executable bit. `pnpm install` fixes it via
postinstall; `node scripts/fix-node-pty.mjs` fixes it by hand, and `task doctor`
reports it.

## Layout

```
packages/db/prisma/schema.prisma    Objective/Workstream/Harness/Pulse/…
apps/server/src/routes/foreman*.ts  API, mutations, SSE
apps/server/src/lib/pulse-engine.ts runner + scheduler
apps/web/src/foreman/               shells/ surfaces/ ui/ data/
scripts/seed-foreman-e2e.ts         the fixture
```

`GET /foreman/objectives/:id/state` is the hot path — the whole dashboard in one
bounded query. The SSE stream opens with that same snapshot, then patches.

## Known gaps

- **Context gauge reads ~0% on live agents.** Pulses are stateless, so a ~400
  token prompt against a 400k window genuinely is ~0%. The fixture's higher
  numbers are fabricated. The gauge only becomes meaningful if harnesses carry
  conversation across pulses — a design decision, not a bug.
- **Chat-model harnesses do no real work.** They reason about state and report;
  they have no tools, and will narrate plausible work that did not happen.
  `HarnessTool.run` records an invocation without executing anything. Harnesses
  on `external:<cli>` DO real work — that is the path that changes files.
- **External CLI cost is usually unreported**, so an `external:` harness with a
  spend cap runs unmeasured. The unpriced-model guard covers chat models only.
- **`mergedToday` uses `Task.updatedAt`**, which any write bumps. There is no
  merge timestamp to key off.
- **Day boundaries are UTC**, so "today's spend" rolls over at 10am AEST.
- **Workspace packages resolve through `dist/`.** Editing `packages/*/src` has
  no effect on a running server until that package is rebuilt — silent, and it
  looks exactly like your change not working. `task doctor` reports it.
- Four places can still resolve a database: the repo root (canonical), the two
  legacy per-package dirs, and `omegaStorageRoot()/pglite-data` when
  `DATABASE_DIR` is unset. `task doctor` reports the first three.

## Tests

```bash
task test:foreman   # 50 server + 28 web
task check          # lint, typecheck, build, test
```

The server suite deliberately asserts values, not shapes — an earlier
`expect.any(Number)` suite let a 75% spend under-report pass. If you add
assertions, assert the number.
