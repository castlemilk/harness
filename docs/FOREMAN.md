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
core chrome reads it today: the active underline on a use-case tab. UC-3 exploits
that seam further with a real domain shell, so resist tinting more of the app by
hand.

### Data sources

A use-case shell usually fronts a backend that is not Foreman's — Victoria's
numbers come from the omega Go API on :8080. A shell **declares** its backends
and **builds its own typed client**:

```ts
const OMEGA = { id: 'omega-api', label: 'Omega API',
                baseUrl: 'http://localhost:8080',
                envVar: 'VITE_UC_OMEGA_API_URL',
                probePath: '/api/v1/dashboard/status' }

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
