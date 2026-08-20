# Foreman

The orchestration layer: an **objective** owns **workstreams**, which own a tree
of **harnesses** (standing agents). Each harness wakes on a heartbeat, runs its
playbook **routine** once, records a **pulse**, and escalates to a human as an
**intervention** when it needs a decision.

## Try it

Three commands, in this order, from the harness repo root:

```bash
task setup          # once per checkout: install, generate the client, migrate
task db:seed:e2e    # load the fixture (25 harnesses, 246 pulses, 5 objectives)
task dev            # API :4000 + web :5173, one database, Ctrl-C stops both
```

`task dev` opens the browser itself and prints where it went. **Do not skip the
seed** — without it Foreman opens on the empty state, which looks like a broken
install rather than an empty database. `task dev:seed` does both in one go.

`task doctor` if anything looks wrong. It checks databases, migrations, port
occupancy, provider keys, stale package builds — and the use-case plugins:
whether `foreman-plugins.json` resolves (a harness cloned without the omega repo
beside it fails the *build*, and doctor says so first), and whether each
plugin's declared backend is answering.

### Victoria live data

The Victoria shell reads the **omega Go API on :8080**, which lives in the
parent repository and which this harness neither starts nor depends on. Without
it the Victoria tabs render honest data-source errors and the Plugins tab shows
a red health dot — that is the designed behaviour, not a fault, and every other
part of the app works regardless.

To have live data, start the omega API from the parent repo in its own shell
(see that repo's `CLAUDE.md`):

```bash
cd ..                                                       # the omega repo
export DATABASE_URL=postgres://omega:omega@localhost:5432/omega?sslmode=disable
make db-up && go run ./cmd/omega-api                        # Connect-RPC on :8080
```

No Docker? `make db-up` is only `docker compose up -d postgres`, so any
reachable Postgres works instead — point `DATABASE_URL` at a scratch database
you create yourself (`createdb omega`), because the omega API creates the tables
it needs on startup and an empty one just makes the Victoria tabs honestly
empty rather than broken.

Deliberately not scripted from here: two repositories with independent
lifecycles, and a harness that started and stopped another repo's server would
own a process it cannot reason about.

**Two ports, and they have to agree.** `OMEGA_API_PORT` is the *server* side —
read by the omega repo's `cmd/omega-api/main.go`, which binds `:8080` unless
that variable says otherwise. `VITE_UC_VICTORIA_URL` is the *client* side, read
at build time by the Victoria shell's data source. Moving the API off :8080
without setting the second one leaves the shell pointed at a port nobody is
listening on, which renders as the same red health dot as an API that is simply
down:

```bash
OMEGA_API_PORT=8085 go run ./cmd/omega-api      # in the omega repo
VITE_UC_VICTORIA_URL=http://localhost:8085 task dev   # here
```

### Worth clicking

| Where | What it should show |
|---|---|
| **Console** | Tree with a depth-4 chain, an *Unassigned* lane, a paused lane. Roster shows all seven statuses. |
| **Board** | Workstream lanes, 12-pulse sparklines, `+N more` overflow, the *Needs you* rail with all three intervention kinds. |
| **Graph** | Auto-fits the whole fleet. Rings are context used. Drag to pan, `⤢` refits, scrubber replays. |
| **Work / Usage / Playbooks** | Tickets scoped to the objective; spend by model against cap; routine editor with a live resolved preview. |
| **Plugins** | Every installed use-case shell: accent, id, version, the source path it came from (in-repo or out-of-tree), its views, its backends with a live health dot, and which objectives use it — each one a jump straight into that shell. A shell nobody uses offers to start an objective on it. |
| **⌘K** | `pause runtime` → acts on the match. `⌘↵` widens to the subtree. |

The second objective ("Keep the support queue at zero") is deliberately empty —
it exists to prove objective-scoping and the empty states. The other three carry
a `useCase` and are how the shell seam is reached by clicking: "Demo the
use-case shell" adds one proof tab, "Run the Victoria trading desk" adds ten
domain tabs against the omega API (which the fixture deliberately does not stand
up, so it also exercises the unreachable-backend path), and "Trade prediction
markets" adds one tab for a shell with no backend at all. Switching between the
last two is where `--uc-accent` visibly changes.

Victoria also carries a fleet of its own — a *Trading desk* workstream with
three desk agents (regime watcher, signal auditor, execution reviewer) across
three statuses, twelve pulses, four tickets and one pending decision — so its
Console, Board, Graph, Work and Usage tabs say something true rather than
sitting empty beside ten populated domain tabs. Polymarket carries exactly one
harness, on purpose: its job in the fixture is to be the shell with no backend,
not a second fleet.

## Use-case shells

Foreman has **two axes**, and conflating them is what produced the triplicated
view list this replaced.

- The **presentation axis** is the core chrome: Console, Board, Graph, Work,
  Usage, Playbooks, Plugins. Seven views, every objective, always. They are the
  app. (Plugins is chrome for the same reason: it is about what the *build*
  installed, so it must be there for an objective with no use case at all.)
- The **domain axis** is the *use case*: what an objective is actually for. A
  use case brings extra tabs, an accent and optionally vocabulary — it **adds**
  to the core chrome and can never remove or shadow it.

`Objective.useCase` (nullable `TEXT`, lowercase slug, validated identically on
`POST /objectives` and in `registerUseCase`) is the discriminator. Null means
core chrome only, which is what every pre-existing objective is.
`viewTabs(CORE_VIEWS, objective.useCase)` derives the bar; `resolveViewId` falls
back to Console when the active view id doesn't exist on this objective.

```
packages/usecase-kit/                         THE CONTRACT: @omega-harness/usecase-kit
foreman-plugins.json                          WHICH PLUGINS THIS BUILD SHIPS — paths, in- or out-of-tree
apps/web/plugin-discovery.mjs                 resolves that config for Vite + Tailwind; missing plugin = build error
apps/web/src/foreman/usecases/registry.ts     the host: the shell map, tabs, resolution
apps/web/src/foreman/usecases/core.tsx        CORE_VIEWS — the seven, and their wiring
apps/web/src/foreman/usecases/plugins.tsx     the Plugins surface — the roster made legible
apps/web/src/foreman/usecases/index.ts        the roster: who is registered, when
apps/web/src/foreman/usecases/health.tsx      probing + the chrome's health dots
apps/web/src/foreman/usecases/demo.tsx        the proof shell (dev/test only)

../foreman-plugins/victoria/                  OUT OF TREE (omega repo) — the trading shell (UC-3), ten tabs, omega API
../foreman-plugins/polymarket/                OUT OF TREE (omega repo) — the prediction-markets stub (UC-4), no backend
```

The two real domain shells are **not in this repository**. They live in omega
(`foreman-plugins/`), depend on nothing but the kit, and are compiled in by
`foreman-plugins.json` — so a harness cloned without omega beside it fails the
build with the missing path in the message, and omega can add a tab without
touching the harness at all.

The contract — `UseCaseShell`, `UseCaseViewProps`, the `ObjectiveState` wire
shapes and `createDataSource` — lives in the workspace package
`@omega-harness/usecase-kit`, which imports nothing from the harness, together
with the shared presentation (`Panel`, `Pill`, `SectionLabel`, `StatusDot`, the
time formatters) on its `/ui` entry, which the app re-exports from
`ui/primitives.tsx` and `ui/format.ts`. A shell imports the kit; the registry
(host state) stays in the app. Consumers resolve
the kit through its `dist/`, so it is built before anything that reads it
(`task build:kit`, declared as a dependency of `lint`, `typecheck`, `test` and
`dev`).

Three properties are load-bearing and easy to break:

- **`UseCaseViewProps` is six fields and never widens.** A shell that needs
  domain data builds its own typed client from `createDataSource` in its own
  module. Foreman never learns a shell's endpoints, types or auth.
- **A registered shell that is not active costs zero requests.** Manifests are
  data; every fetch originates in a view-level hook.
- **Registration goes through `registerRoster`**, which replaces the previous
  roster so Vite HMR doesn't collide with it. Duplicate ids still throw.
- **A shell is a pure export.** It exports a `UseCaseShell` object and registers
  nothing; `usecases/index.ts` is the single registration point. That is what
  lets a shell live in another repository with only the kit as a dependency.
- **Which plugins a build ships is configuration**, read at build time from
  `foreman-plugins.json` (override: `FOREMAN_PLUGINS=…`) and turned into static
  imports. A configured plugin that is not on disk fails `task dev` and
  `vite build` with its path in the message — never a blank tab.

📖 **[docs/USE-CASE-SHELLS.md](./USE-CASE-SHELLS.md) is the authoring guide** —
the full contract, data sources and the health dot, the Victoria file-by-file
walkthrough, the honesty rules, HMR semantics, testing conventions and the
phase-2 path. Read it before writing a shell.

### Where the wire becomes the view model

`types.ts` is both the render model and the wire format — the server serialises
`ObjectiveState` exactly as the shells consume it, so there is no field mapping
to keep in sync. The half of it that `ObjectiveState` is made of is defined in
`@omega-harness/usecase-kit` (a plugin is handed `state`, so it has to be able
to name the type) and re-exported by `types.ts`, which still owns what only the
core chrome renders: transcripts, usage, tools, playbooks. Validation stayed in
the app — the kit ships the contract, the host enforces it. `data/adapt.ts` owns
what is left at that seam:

- `projectObjectiveState(wire)` — the boundary check for a whole snapshot, run
  on the fetched state *and* the SSE `init` frame. It asserts only the
  load-bearing invariants (arrays are arrays, ids are non-empty strings, spend
  is finite) and throws naming the field. It is deliberately not a schema
  validator: that would be `types.ts` in a second dialect, free to drift. A bad
  SSE frame drops the app onto polling instead of rendering `NaN`.
- `projectHarnessPatch` / `projectPulse` / `projectIntervention` — the same door
  for the three per-entity SSE patches, which used to be plain casts. A harness
  patch is a *patch* only in effect: for a harness this client has never seen
  (another operator spawned one while this one watched) it is appended whole, so
  a payload without `recentPulses` put `undefined` where every shell calls
  `.map`. The projectors default the two list fields a shell walks
  (`recentPulses`, `routine`) rather than trusting them. The server now sends
  `recentPulses` on the patch as well — both halves of that bug were real.
- `applyHarnessPatch` / `applyPulse` / `applyIntervention` — the merge rules,
  pure and React-free. An empty `recentPulses` on a patch means "nothing recent"
  (the stream's pulse window is narrower than the snapshot's), so it never
  erases pulses already on screen.
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

## Tool execution

A `HarnessTool` is a button in the Toolkit that runs a **shell command in the
objective's project checkout**. That is a browser button running a command on
the host, as you.

```bash
FOREMAN_TOOLS=1 task dev      # without this, tools execute NOTHING
```

### What is actually load-bearing

Be precise about which of these stop an adversary and which are workflow. Only
four are controls:

1. **The flag.** With `FOREMAN_TOOLS` unset nothing executes, ever. This is the
   only fence that holds against a caller who can reach the API at all.
2. **The command text is not writable over HTTP.** It comes from the stored tool
   definition; the request body is ignored, and no route accepts a command
   string. The gate decides *whether*, never *what*. (Whoever can write the
   database, or run `POST /foreman/harnesses/:id/tools`, defines commands — that
   is a different, higher privilege.)
3. **The loopback bind.** `HOST` defaults to `127.0.0.1`. On any other bind,
   `FOREMAN_TOOLS=1` is a remote shell for everyone who can reach the port, and
   the server prints a loud multi-line warning at startup saying exactly that.
4. **`FOREMAN_TOOLS_SECRET`, when set.** `POST /harnesses/:id/tools/:toolId/run`
   and `POST /interventions/:id/resolve` **for `approval`-kind interventions**
   then require header `x-foreman-tools-secret` to match (timing-safe compare).
   A missing or wrong secret is `401` with **no side effects at all**: no run
   row, no permission entry, no intervention, no resolution. Every other
   intervention kind (question, budget, diff, retire) resolves unauthenticated
   as before. Unset means the routes are unauthenticated — the local-trusted
   posture, where the loopback bind is the whole story.

**Permissions and approvals are operator workflow, not an adversarial
boundary** — unless the secret is set. `PATCH /foreman/harnesses/:id` writes
`permissions` verbatim, and until this change resolve was unauthenticated, so
any caller who could reach the run route could also grant itself the permission
that route checks. The permission list answers "did a human mean to allow
this?", which is a real and useful question; it does not answer "is this caller
allowed to ask?". The secret is what answers that.

### The gate, mechanically

- **Permission gate.** Execution needs a *granted* entry in
  `Harness.permissions` whose id is the tool's `permissionId` (default
  `tool:<id>`) **whose own `needsApproval` is not set**. No grant → nothing
  runs: the run is recorded as `blocked-pending-approval` and one `approval`
  intervention is raised for the Needs-you rail, deduplicated **per tool** (the
  match is on the tool id in the payload, so alternating two blocked tools
  raises two interventions, not one per click). A tool flagged `needsApproval`
  asks every single time, granted or not — and the intervention says so instead
  of promising "always allow" will stop the asking, which it cannot.
- **Approval round trip.** Resolving with **approve** stores the intervention id
  on the tool as a one-shot grant. The next run **claims** that grant with a
  conditional update *before* it spawns, so N simultaneous runs cannot all
  consume one approval — the losers fall through to the ordinary blocked path.
  **approve-always** flips the permission to granted, and only an
  `approval`-kind intervention can do that: a diff/budget/question intervention
  carrying a `permissionId` in its payload is refused with `400`.
- **Concurrency.** One in-flight run per tool, three per harness, counted from
  the pre-spawn `running` rows. Over the cap is `429` with `{scope, running,
  limit}` in the body and **no run row** — a row per rejected request would make
  the rate limiter its own unbounded write amplifier, which is the DoS the cap
  exists to prevent. A `running` row older than 11 minutes (the hardest timeout
  plus a minute) cannot be live, so it is excluded from the count: a crash
  cannot brick a tool permanently.
- **Bounds.** 60s default timeout (`HarnessTool.timeoutMs`, capped at 10m),
  killed as a process group (SIGTERM, then SIGKILL) — POSIX-only and
  best-effort: a child that calls `setsid` leaves the group and survives. 64 KB
  of output captured (decoded with a `StringDecoder`, so a multi-byte character
  spanning the boundary is not mangled) and a 2 000-character excerpt persisted;
  cwd must `statSync().isDirectory()`, and anything else is record-only, not a
  guess.

Every attempt writes a `HarnessToolRun` — **except** a concurrency rejection,
which writes nothing by design. An executing run gets its row **before** the
spawn with status `running`, updated in place to `ok`/`fail`/`timeout`/`error`
when it settles: one attempt is one row, with a stable id. A run whose server
died mid-command stays `running` forever, which is the truth. The row carries
command, cwd, exit code, duration, output excerpt, and the permission id *or*
intervention id that authorised it.

### Disclosure and blast radius — read this before exposing anything

- **Run output and command text are readable by any caller — unless the secret
  is set.** Five reads serialise one or the other. The ≤2 000-char excerpt and
  the command reach `GET /harnesses/:id/tools` and `GET /harnesses/:id` (whose
  payload carries the whole toolkit); the command alone reaches every read that
  carries a pending tool *approval*, which publishes it twice, in
  `payload.command` and in the first line of `detail` — that is
  `GET /objectives/:id/state`, `GET /interventions` and the SSE init/patch
  frames on `GET /stream`. With `FOREMAN_TOOLS_SECRET` set all five demand the
  same `x-foreman-tools-secret` header — but a missing or wrong one **redacts
  rather than refuses**: every name, group, status, tone, exit code, duration,
  cwd, permission id, intervention title and impact stays intact, and only
  `command`, `lastRun.output` and the approval's copies of the command become
  the literal `«secret required»`. The Toolkit renders that marker as "output
  hidden — tools secret required"; an approval's detail carries it inline as
  `Command: «secret required»`, so the ask stays answerable.
  Redaction, not `401`, because these serialisers are reached through composite
  reads a read-only dashboard makes without any secret; failing the whole
  request would break a page over a field it never renders. `GET /stream` also
  accepts the secret as `?toolsSecret=` — `EventSource` has no header channel,
  and a stream that always redacted would overwrite the readable commands the
  fetched state just put on screen. That is a real widening (query strings reach
  proxy logs and `Referer`; headers do not), accepted on the same footing as
  shipping the secret to the SPA at all. With the secret unset every read is
  open exactly as before, and a tool that prints a token, a connection string or
  a customer record has still published it to anyone who can read the API.
- **The scrubbed environment protects the SERVER's secrets, not the host.** The
  allowlist (`PATH`, `HOME`, `SHELL`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TZ`,
  `TMPDIR` plus `GIT_TERMINAL_PROMPT=0`, `TERM=dumb`, `CI=1`) keeps provider API
  keys and `DATABASE_URL` out of the child. It does nothing about the
  filesystem: the command runs as the invoking user with that user's full
  rights — `~/.ssh`, `~/.aws`, gcloud's application-default credentials, and the
  checkout's own `.env` are all readable, and `curl` is on `PATH`.
- **Binding a tool to a generic, already-granted permission skips the
  ceremony.** `HarnessTool.permissionId` is free text. Point it at a broad
  permission the harness already holds (the seeded `run-command` is exactly
  this) and the tool executes on first click with no intervention, because the
  gate only asks "is *that id* granted?". Custom `permissionId` plus the seeded
  generic grants is an operator decision, and a deliberately quiet one.
- **`DELETE /projects/:id` cascades away the entire tool audit trail.**
  Project → Objective → Harness → HarnessTool → HarnessToolRun are all
  `onDelete: Cascade`, so deleting a project silently destroys every record of
  what was ever executed against it. There is no archive.
- **The web UI's `VITE_FOREMAN_TOOLS_SECRET` is not authentication.** The
  Toolkit and intervention surfaces send the header — on all five reads as well
  as the two write routes, and as the stream's query parameter — when the build
  was given that variable, which is dev convenience. A secret compiled into a
  served SPA is readable by anyone who loads the page; all it really buys is
  that a cross-origin page cannot forge the request — CSRF-grade. Real
  deployments should keep the loopback bind.

Known deviation: tool runs do **not** emit their own SSE event. The stream
diffs harnesses, pulses and interventions, so a *blocked* run surfaces live via
its intervention, while a successful run surfaces in the run response and the
next `GET /harnesses/:id/tools`. Adding a `tool` event means teaching the
stream a fourth table — worth doing when a background caller can fire tools.

Behaviour change worth knowing, since an earlier draft of this page claimed the
flag-off path was byte-identical to the pre-execution API — it is not. With
`FOREMAN_TOOLS` unset, running a tool now **inserts a `HarnessToolRun` row**
(status `recorded`) where it previously wrote nothing but the tool's two
columns, and the response now carries `executable` and `lastRun`. The
`lastStatus` / `lastResultLabel` / `lastRanAt` triple and the "Not executed:
execution is not configured; request recorded only" label are unchanged.

## Layout

```
packages/db/prisma/schema.prisma    Objective/Workstream/Harness/Pulse/…
apps/server/src/routes/foreman*.ts  API, mutations, SSE
apps/server/src/lib/pulse-engine.ts runner + scheduler
apps/server/src/lib/tool-runner.ts  tool execution: flag, permissions, bounds
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
- **Chat-model harnesses do no real work of their own.** They reason about
  state and report; they will narrate plausible work that did not happen.
  Harnesses on `external:<cli>` DO real work — that is the path that changes
  files. A human can also fire a `HarnessTool` at any harness, which really
  executes (see "Tool execution"), but nothing the *model* decides can reach a
  tool: execution is human-initiated only, and only under `FOREMAN_TOOLS=1`.
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
task test:foreman   # 79 server + 84 web
task check          # lint, typecheck, build, test
```

The server suite deliberately asserts values, not shapes — an earlier
`expect.any(Number)` suite let a 75% spend under-report pass. If you add
assertions, assert the number.
