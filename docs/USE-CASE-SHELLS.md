# Use-case shells

How to add a domain to Foreman without touching Foreman.

This is the working document for the seam introduced in UC-1..UC-4. `FOREMAN.md`
summarises it; everything below is the detail you need to actually write one.

- [The two axes](#the-two-axes)
- [When to build a shell](#when-to-build-a-shell)
- [The contract](#the-contract)
- [Data sources](#data-sources)
- [Anatomy: the Victoria walkthrough](#anatomy-the-victoria-walkthrough)
- [Honesty rules](#honesty-rules)
- [Registration, the roster and HMR](#registration-the-roster-and-hmr)
- [Testing](#testing)
- [Phase 2: growing a shell](#phase-2-growing-a-shell)

---

## The two axes

Foreman has two axes, and conflating them is what produced the triplicated view
list this seam replaced.

- The **presentation axis** is the core chrome: Console, Board, Graph, Work,
  Usage, Playbooks. Six views, every objective, always. They are the app.
- The **domain axis** is the *use case*: what an objective is actually for —
  trading a book, triaging support, shipping a feature. It brings extra tabs, an
  accent and optionally vocabulary. It **adds** to the core chrome and can never
  remove or shadow it.

`Objective.useCase` (nullable `TEXT`, lowercase slug, validated identically on
`POST /objectives` and in `registerUseCase`) is the discriminator. Null means
core chrome only, which is what every pre-existing objective is.

**Core views are not a use case**, and are deliberately not modelled as a
reserved shell. They receive `CoreViewContext` — Foreman's internals, including
the focused harness's tools and the playbook draft. Registering them as a fake
use case would have forced one of those two contracts to become the other:
either widen the guest contract to everything the app holds, or lie about a
'core' use case no objective can be assigned.

The contract and the host are two different places, and the split is the point:
a shell imports the **kit** and never the app.

```
packages/usecase-kit/src/shell.ts             THE CONTRACT: UseCaseShell, UseCaseView(Props), Vocabulary
packages/usecase-kit/src/state.ts             the wire shapes `props.state` is made of
packages/usecase-kit/src/data-source.ts       how a shell reaches its own backend
packages/usecase-kit/README.md                what a plugin author reads first

apps/web/src/foreman/usecases/registry.ts     the host: the shell map, tabs, resolution
apps/web/src/foreman/usecases/core.tsx        CORE_VIEWS — the six, and their wiring
apps/web/src/foreman/usecases/index.ts        the roster: who is registered, when
apps/web/src/foreman/usecases/health.tsx      probing + the chrome's health dots
apps/web/src/foreman/usecases/vocabulary.tsx  the provider that renders a shell's words
apps/web/src/foreman/usecases/demo.tsx        the proof shell (dev/test only)
apps/web/src/foreman/usecases/victoria/       the trading shell (UC-3) — the worked example
apps/web/src/foreman/usecases/polymarket/     the prediction-markets stub (UC-4)
```

`@omega-harness/usecase-kit` is a workspace package that imports nothing from
the harness: a plugin depends on the kit, the kit depends on React's *types*
alone, and the harness depends on both. Consumers resolve it through its
`dist/`, so **rebuild it after changing it** (`task build:kit`, and every task
that needs it declares that dependency) or you are typechecking against the
previous contract.

## When to build a shell

Most work does **not** need one. An objective, its harnesses and the six core
views already cover "a fleet of agents is doing a thing and I want to watch it".

Build a shell when **all three** hold:

1. There is domain state the core chrome structurally cannot show. Not "would be
   nice next to" — cannot. Victoria's equity curve, regime mix and per-run gate
   deltas are not harnesses, pulses, tickets or spend, so no core view has a
   place to put them.
2. That state has a **vocabulary of its own** that an operator would use out
   loud. If you can describe every tab you want as "the pulses, but filtered",
   you want a core-view improvement, not a shell.
3. Someone will actually run an objective with that `useCase`. A shell with no
   objective is a tab nobody can reach.

If only (1) and (2) hold and there is no backend yet, you can still build the
shell — see [Polymarket](#polymarket-the-honest-stub) for what that looks like
done honestly. What you may **not** do is invent numbers to fill it.

## The contract

Everything in this section is exported from `@omega-harness/usecase-kit`. A
shell imports it from there — `import type { UseCaseShell, UseCaseViewProps }
from '@omega-harness/usecase-kit'` — in this repository and in any other.

### `UseCaseShell`

```ts
export interface UseCaseShell {
  id: string;                              // matches Objective.useCase; lowercase slug
  name: string;                            // "Victoria — market trading"
  accent?: string;                         // CSS colour → --uc-accent while active
  vocabulary?: Partial<Record<'harness' | 'pulse' | 'objective', string>>;
  views: UseCaseView[];                    // tabs ADDED to the core tabs
  dataSources?: UseCaseDataSourceConfig[]; // backends, for the health dots
}
```

- **`id`** must satisfy `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — the same rule the server
  enforces on `POST /objectives`, so an id that registers is an id an objective
  can carry.
- **`name`** is the human label. Convention is `<Project> — <what it is>`, taken
  from the project's YAML in the omega repo where one exists.
- **`views`** is the tab list. Every view id must be **namespaced with the shell
  id** (`victoria-equity`, `polymarket-pipeline`). `viewTabs` silently drops a
  view whose id collides with a core view rather than letting a shell make
  Console unreachable — namespacing means you never hit that.

### `UseCaseViewProps` — six fields, and they never grow

```ts
export interface UseCaseViewProps {
  objectiveId: string;
  state: ObjectiveState;                    // the same snapshot core views render
  focusId: string | null;
  onFocus: (harnessId: string | null) => void;
  onOpenView: (viewId: string) => void;     // core or use-case
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}
```

This is the whole plugin surface: the objective it renders, the harness in
focus and the ability to move it, the ability to send the operator to another
tab, and one funnel for mutations so a domain view's failures land in the same
error rail as everything else.

**The never-widen rule.** `UseCaseViewProps` does not grow to carry domain data.
Ever. If your view needs markets, trades or tickets, it fetches them through its
own client in its own module (see [Data sources](#data-sources)). The moment the
guest contract carries one shell's data it carries every shell's, and Foreman
becomes a union of its plugins. Before adding a field, check whether you can
derive it from `state` — that is almost always the answer, and widening is a
real API decision, not a convenience.

**Enforced, not just asked for.** `eslint.config.js` restricts imports inside
the shell directories (`victoria/`, `polymarket/`, `demo.tsx`; the host's own
`core.tsx`, `registry.ts` and `health.tsx` are exempt, as are test files). A
shell may not import:

- `usecases/core.js` — the core views' privileged context;
- `data/api.js` or `data/useForeman.js` — Foreman's own API client;
- `ForemanApp.js` — the app shell;
- `usecases/registry.js`, `usecases/health.js` or `foreman/types.js` — the
  **host's** copy of the seam. Import the contract from
  `@omega-harness/usecase-kit` instead.

Each is a lint error naming what to use instead. The last group is the one that
keeps a shell portable: reaching for `../registry.js` compiles fine in-tree and
is exactly what would break the day the shell moves to its own repository.

### View ordering

`order` sorts ascending; views without one keep roster order, after those with.
Use decades (`10, 20, 30…`) so a view can be inserted later without renumbering.
Core tabs always come first in the bar, in their own order; a shell cannot
interleave with them.

### Accent and `--uc-accent`

`accent` is set on the Foreman root as the CSS variable `--uc-accent` while the
shell is active (stock `#e8963c` without one). Exactly one piece of core chrome
reads it: the active underline on a use-case tab. Everything else that uses it
is **inside the shell's own views** — Victoria's equity stroke and loading
pulse, Polymarket's step badges. That is the intended way to exploit the seam;
resist tinting more core chrome by hand.

Picking a colour:

- If the project's YAML declares one, start there — but bring it onto the
  palette. `victoria.yaml` declares `#00ff00`, pure sRGB green, which vibrates
  against the text ramp on the near-black canvas and reads as a terminal error;
  the shell keeps the hue and lands on `#3fd97d`, next to the palette's own
  `ok`.
- If it declares nothing, take a token from `tailwind.config.js` that **no
  status colour uses**. Green, amber and red all mean something on a harness, so
  a domain accent that collides with a status reads as an alarm. Polymarket
  takes `violet` (`#a67ff0`) for this reason.
- Two shells that might be open in adjacent tabs should be distinguishable by
  colour alone.

### Vocabulary

`vocabulary` renames display terms — `harness`, `pulse`, `objective`. Anything
omitted keeps the Foreman word.

**It reaches exactly four chrome-level labels, and nothing else:**

| Where | Foreman | With Victoria active |
| --- | --- | --- |
| Console roster filter (`ConsoleShell`) | `Filter harnesses…` | `Filter desk agents…` |
| Console empty focus column (`ConsoleShell`) | `No harness selected.` | `No desk agent selected.` |
| Command palette prompt + result heading (`CommandPalette`) | `Jump to a harness or ticket…` / `Harnesses` | `Jump to a desk agent or ticket…` / `Desk agents` |
| Graph inspector cost heading (`GraphShell`) | `This harness` | `This desk agent` |

It does **not** rename body copy, tooltips, dialog titles, mission text, or a
shell's own views — and it is not "chrome-wide". Delivery is
`usecases/vocabulary.tsx`: `<VocabularyProvider>` at the root of `ForemanApp`,
`useVocabulary()` at each label, with `pluralise` and `caps` for the two forms
the labels need. Adding a label to the list is a one-line change at the label;
threading the rename through every sentence in six core views is not, and the
promise the manifest makes is deliberately the small one that is kept exactly.

Rename only when the domain word is genuinely better in those places. Victoria
renames `harness` → `desk agent` because "spawn a desk agent" and "3 desk agents
working" both read correctly. It leaves `pulse` and `objective` alone: no
trading word improves on them, and renaming for the sake of symmetry makes the
app harder to talk about across two objectives in one project. Polymarket
renames nothing, which is a fine answer.

## Data sources

A shell usually fronts a backend that is not Foreman's. It **declares** its
backends on the manifest and **builds its own typed client**:

```ts
export const OMEGA_SOURCE = {
  id: 'omega-api',
  label: 'Omega API',
  baseUrl: 'http://localhost:8080',
  envVar: 'VITE_UC_VICTORIA_URL',
  probePath: '/api/v1/training/versions',
};

export const omega = createDataSource(OMEGA_SOURCE);   // in the shell's own module

export const victoriaUseCase: UseCaseShell = { /* … */ dataSources: [OMEGA_SOURCE] };
```

Declaring a source hands the shell's views **nothing**. What it buys is chrome:
while the shell is active Foreman probes each source and shows a health dot.
Foreman never learns the shell's endpoints, types or auth — only that a source
exists and where it lives.

### The client

`createDataSource` returns four methods, all plain `fetch`, no client codegen:

| Method | Shape |
|---|---|
| `getJson<T>(path)` | REST GET |
| `postConnect<T>(service, method, body?)` | Connect-JSON unary: `POST /<service>/<method>`, `Connect-Protocol-Version: 1` |
| `sse(path, onMessage, opts?)` | EventSource; returns the close function |
| `probe()` | The health check: `{ ok, latencyMs?, error? }` |

The transport deliberately mirrors `web/dashboard/src/lib/api.ts` in the omega
repo, because that is what the Go API actually serves. A shell that wants
generated stubs may bring them; nothing here forbids it.

### `probePath`

Pick a **cheap GET with no dependencies beyond the service itself**. Victoria
probes `/api/v1/training/versions`, which reads a directory listing and needs no
database — so the dot reports "is the API reachable", not "does Postgres happen
to be seeded". A probe that touches the database turns an empty fixture into a
red dot and teaches the operator to ignore it.

### Env override convention: `VITE_UC_<ID>_URL`

When set and non-empty it replaces `baseUrl`; it is the only supported way to
repoint a shell at another backend, so it is part of the shell's public surface
and belongs in the shell's doc comment.

The lookup goes through a bag the **host** injects: `main.tsx` calls
`setUseCaseEnv(import.meta.env)` once. The kit cannot read `import.meta.env`
itself — it ships pre-built `dist/`, which Vite does not rewrite, so a bare
`import.meta.env` in there survives into the bundle unreplaced and evaluates to
`undefined`, silently pinning every shell to its declared `baseUrl`. Resolution
is lazy, so a client built at module scope (which every shell does) still sees
the bag; `setUseCaseEnv` is the host's to call and a plugin's never to. `registerUseCase` rejects duplicate
source ids within a shell — two sources under one id means one health dot
silently replaces the other.

### Named-event SSE

`sse` delivers unnamed frames to `onMessage` by default. A stream that uses
**named** events lists them in `opts.events` and reads `ev.type` to tell them
apart:

```ts
omega.sse('/api/v1/training/events/stream', onFrame, { events: ['connected', 'progress'] });
```

The omega training stream writes `event: connected` then `event: progress`,
neither of which an `onmessage` handler ever sees — an EventSource only routes
frames with **no** `event:` line there. The names stay the caller's to supply;
the seam never guesses a shell's event vocabulary, which is how you end up with
a second, worse EventSource.

### The health dot

An empty domain tab and a dead backend look identical, so while a shell with
declared sources is active the chrome shows one dot per source next to the
stream indicator — green reachable, red unreachable, dim while probing, with the
label, resolved URL and latency (or error) on hover. Probed on mount and every
30s. Colours come from the fleet's status palette, so red means the same thing
in the chrome as on a harness.

A shell with **no** sources shows no dots. That is correct, not a gap — see
Polymarket.

### Surfacing `DataSourceError`

A failed request throws a `DataSourceError` carrying the HTTP status and a
400-character body excerpt (bounded so an HTML error page cannot flood a panel).

**Render it. Do not reduce it to "failed to load."** The status and the excerpt
together are an actionable sentence — `Omega API: GET /api/v1/training/progress
failed: 500 failed to parse progress file` tells an operator what is broken and
whose problem it is. Throwing that away sends them to devtools, which is the
exact thing the seam exists to avoid. Victoria's `ErrorNote` in
`views/chrome.tsx` is the pattern; hooks keep the error **object**, not a
stringified message, so the renderer can still ask whether it was a
`DataSourceError`.

Mutations go through `props.mutate`, which lands failures in the core error
rail alongside every other failure in the app.

**A partial failure is not an empty state.** A view reading two sources with
`Promise.allSettled` (Victoria's Trades reads the training JSONL *and*
`GetTrades`) must keep the good half AND say which half is missing — see
`settleTrades` in `victoria/hooks.ts`, which returns the rows plus a `failures`
list the view renders as an `ErrorNote` per source. Drawing "no rows" over a
source that answered 500 sends the operator to look for a seeding problem that
does not exist.

### Shell inactive ⇒ zero requests

**A registered shell that no objective has selected must cost zero requests.**
This is load-bearing: shells are registered eagerly at module load, so if
registration could fetch, every operator would pay for every shell on every page
load.

How to hold the line:

- The manifest module is **data only**. It may `createDataSource` (which
  constructs an object and calls nothing) but must never fetch at module scope.
- Every request originates in a **view-level hook**, i.e. inside `useEffect`
  after the view mounts.
- `startHealthProbes` is gated on there being an active shell with sources, and
  is a plain function rather than a hook precisely so that gating is testable
  without a renderer.

How to verify — **and the file this goes in matters**:

```ts
// usecases/<shell>/manifest-cost.test.ts — its OWN file, with no static import
// of the manifest (or of anything that pulls it in, including `../index.js`).
it('opens no request and no stream when the shell is merely registered', async () => {
  vi.resetModules();
  const fetchSpy = vi.fn();
  const eventSourceSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('EventSource', eventSourceSpy);

  const module = await import('./index.js');   // the manifest really executing

  expect(module.<shell>UseCase.id).toBe('<shell>');   // proof the import ran
  expect(fetchSpy).toHaveBeenCalledTimes(0);
  expect(eventSourceSpy).toHaveBeenCalledTimes(0);
});
```

The isolation is the whole test. Written next to a **static** import of the same
module — which is what `shell.test.ts` has — the dynamic import returns the
cached module, the manifest never re-executes, and a module-scope `fetch` fires
before the stub exists. That guard passes over a real regression; it was
verified doing exactly that before this file was split out. `vi.resetModules()`
plus no static import is what makes it able to fail.

Both shells carry this test, in `manifest-cost.test.ts`. In the browser: open
devtools' network tab on an objective with **no** use case and confirm nothing
goes to the shell's backend.

## Anatomy: the Victoria walkthrough

`usecases/victoria/` is the worked example — six tabs reading the omega Go API
on `:8080`. Read it in this order; the dependency direction is strictly
downward, and nothing below imports anything above it.

```
victoria/index.ts          the manifest — data only, fetches nothing
victoria/client.ts         typed client: 8 Connect RPCs + 6 REST endpoints + the SSE stream
victoria/hooks.ts          one hook per view, each returning the same Async<T> triple
victoria/geometry.ts       chart maths — pure, React-free, asserted to exact coordinates
victoria/charts.tsx        bespoke SVG: Sparkline, LineChart, HeatGrid
victoria/format.ts         trading formatters (signed money, unclamped pct, regime colour)
victoria/views/            Overview, Runs, Live, Trades, Equity, Signals + shared chrome
```

**manifest** (`index.ts`) — the `UseCaseShell` object and the accent constant,
with the reasoning for both in comments. It imports the views and the source
config, and does nothing else. `registry.ts` never learns an endpoint.

**client** (`client.ts`) — every type the shell reads, and one function per
endpoint. It lives in the shell's module because the guest contract never
widens, so views import it directly.

**hooks** (`hooks.ts`) — one hook per view, all returning the same
`Async<T> = { data, loading, error }` triple so the shared `<Async>` renderer
presents loading, failure and success identically across six views. The failure
branch keeps the `DataSourceError` itself.

**geometry** (`geometry.ts`) — the chart arithmetic, with no React and no SVG in
sight. Foreman draws its own charts (`PulseSparkline` in `ui/primitives.tsx` is
the precedent; there is no chart library in the tree). Keeping the maths here is
what makes it testable to exact coordinates: a path string is a value, and a
test that asserts the value catches an inverted y-axis, which a test that
asserts "it rendered a `<path>`" never will.

**views** (`views/`) — one file per tab, plus `chrome.tsx` for the furniture
they share (`ViewFrame`, `Card`, `Stat`, `Table`, `ErrorNote`, `EmptyNote`,
`LoadingNote`, `<Async>`). Six views each inventing their own loading spinner is
six chances to swallow an error or to render an empty table that looks identical
to a dead backend, so the three states are decided once. Pure per-view logic
(`sortVersions`, `summariseByRegime`, `maxDrawdown`) is exported from the view
file and tested directly.

### The provenance-comment convention

The omega Go API is a separate repo with no shared package, so **every
hand-derived type names its source in a comment**: the proto message, the Go
handler, or the YAML file it was transcribed from, plus the date it was checked.

```ts
/**
 * ── Provenance ────────────────────────────────────────────────────────────
 * Transcribed from `projects/polymarket.yaml` in the omega repo, read on
 * 2026-08-18. Hardcoded on purpose: the harness has no dependency on the omega
 * repo's files and no endpoint serves a project's pipeline.
 */
```

This is not decoration. A hand-derived type is a copy that can drift silently,
and the comment is the only thing that tells the next person which file to
re-read. Two properties of omega's wire drove most of Victoria's client and are
the kind of thing the comment must capture:

1. Connect-JSON serialises proto fields as **lowerCamelCase**
   (`compositeDirection`, `trainEnd`), not snake_case.
2. Connect-JSON **omits zero-valued fields entirely**. `GetPositions` against an
   empty database answers `{}`, not `{"positions":[]}`. So every RPC type is
   fully optional, every reader defaults it, and "absent" renders as an em dash
   rather than `0.00`. A non-optional `positions: Position[]` would throw on the
   empty state — which is the state a fresh checkout is actually in.

The REST half (`/api/v1/training/*`) is Go structs with explicit snake_case json
tags, so those types are snake_case and their required fields really are always
present. Same wire, two dialects; the provenance comment is what stops you
guessing which one you are in.

### Fixtures from live captures

Client tests assert against **response bodies captured from the running
backend**, not bodies invented to match the types. The invented kind tests that
your parser agrees with your own assumptions; the captured kind catches the
assumptions being wrong. Everything Victoria's tests know that its types alone
would not — that `/versions` answers 450 rows with 449 distinct labels because
two results files both declare `"v10"`, that version labels include
`v252_replay_2025-03-05`, that `sharpe_ratio` is `0` for every row — came from a
capture, and each is now a test with a comment saying it was observed live.

## Honesty rules

The point of a domain tab is that an operator can trust it. Three rules:

**1. Empty state, error state and no-backend state are different, and must look
different.** "No data" and "no endpoint" have different fixes and only one of
them is the operator's. Name which one it is.

**2. Render real backend errors verbatim.** The `/progress` story is the worked
example: `/api/v1/training/progress` decodes `data/training_progress.json` into
a *struct*, but omega's `run_training.py` writes a JSON *array* of per-cycle
records to that path — so it answers **HTTP 500** whenever a real run has
happened. The Live view could have caught that and shown "no run in progress".
It would have been tidier and completely wrong: there *was* a run, and the
operator would have been misinformed by their own dashboard. Instead Live treats
`/progress` as enrichment over `/metrics` (DB-backed, always answers) and renders
the 500 with its body and an explanation. A dashboard that hides a broken
endpoint is worse than no dashboard.

**3. Never render a number you did not get.** If a field is absent, show an em
dash. Victoria's `sharpe_ratio` is `0` for every row because the handler reads a
key the results files do not carry; rendering "0.00" would assert a real and
terrible Sharpe. The em dash says what is true, which is that the number is not
recorded.

### Polymarket: the honest stub

`usecases/polymarket/` (UC-4) is what a shell looks like when the domain is real
and the backend is not. Polymarket has six Python nodes
(`omega/nodes/polymarket/`), a Go client (`internal/polymarket/client.go`) and a
project definition — but `cmd/omega-api` and `internal/handler` register **no
Connect service and no REST route** for any of it. So the shell:

- declares **no `dataSources`** — not an aspirational entry pointing at `:8080`,
  which would put a permanently red dot in the chrome and train the operator to
  ignore dots;
- has **one view**, which renders the pipeline from `projects/polymarket.yaml`
  as a static, provenance-commented constant, plus the eval targets, labelled as
  targets rather than measurements;
- says out loud that there is no backend, naming exactly which files exist and
  which route is missing, and lists the four views phase 2 would add (markets,
  edge table, weather ensemble, bet ledger).

The alternative was a tab full of plausible-looking zeroes. It is worth being
able to build the second shell in an afternoon and have it be *true*; that is
what "the seam works" means.

## Registration, the roster and HMR

Registration is **eager and static**. There is no dynamic import, no plugin
discovery and no network fetch, so a missing shell is a build error in the
roster rather than a blank tab at runtime.

**A shell is a pure export.** Its module exports a `UseCaseShell` object and
does nothing else at import time — no `registerUseCase`, no fetching, no side
effects. The convention is a named export (`export const victoriaUseCase:
UseCaseShell = { … }`). A shell that registered itself could not be tree-shaken,
could not be tested without the app, and would make import order behaviour.

`usecases/index.ts` is the roster and the only place registration happens.
Importing it is what makes shells exist; `ForemanApp` imports it for that side
effect. Every shell in the app is visible in that one file — a flat list of
imports and one array — rather than scattered across self-registering modules.

```ts
const roster: UseCaseShell[] = [victoriaUseCase, polymarketUseCase];
if (import.meta.env.DEV) roster.push(demoUseCase);   // false in `vite build`
registerRoster(roster);
```

Ship a shell in every build if a real objective can carry its `useCase` — that
includes backend-less ones like Polymarket, because the objective exists so the
tab must. Gate on `import.meta.env.DEV` only for shells that exist to prove the
path (`demo`), where tree-shaking then removes the view from prod entirely.

### Collision rules

`registerUseCase` throws rather than overwriting, in four cases:

| Case | Message |
|---|---|
| id is not a lowercase slug | `Use-case id must be a lowercase slug: "…"` |
| id already registered | `Use case "x" is already registered` |
| a view id repeated within the shell | `Use case "x" registers view "y" twice` |
| a source id repeated within the shell | `Use case "x" declares data source "y" twice` |

Silently overwriting means one registration never renders and there is nothing
at runtime to point at, so a stack trace at import time is the kinder failure.

Two things are *not* errors: a view id that collides with a **core** view is
dropped by `viewTabs` (a shell must never make Console unreachable), and an
unknown `useCase` on an objective simply yields the core tab bar.

### HMR: why `registerRoster` exists

`shells` lives in `registry.ts`, which is a *dependency* of the roster rather
than an importer of it — so it is **not** re-executed when a shell file changes.
The roster is. Editing `victoria/index.ts` invalidates it and every importer up
to the nearest accepting boundary (`ForemanApp.tsx`, self-accepting via
react-refresh); re-importing that boundary re-executes the roster against a
`shells` map that still holds the previous entries, and `registerUseCase`
throws "already registered". Before UC-4 the app sat on a red overlay until a
full reload — friction on every edit to any shell manifest.

`registerRoster(shells)` fixes it by **replacing the previous roster by
provenance**: it removes exactly the ids its own last pass registered, then
registers the new list through the unchanged `registerUseCase`. It tracks those
ids itself rather than deriving them from the map, so it can never evict a shell
somebody else put there.

Every collision rule survives intact. Two roster entries claiming one id still
throw (the first is in the map by the time the second is offered); a roster
entry colliding with a shell registered elsewhere still throws; slug and
view/source duplication are still validated per shell.

Two alternatives were rejected, and it is worth knowing why:

- **`import.meta.hot.dispose` in the roster.** Vite 5's client looks the
  disposer up as `disposeMap.get(acceptedPath)` (`client.mjs`, `fetchUpdate`),
  so it fires only for the module that *accepted* the update — `ForemanApp.tsx`,
  not the roster. A roster disposer would simply never run, unless the roster
  self-accepted, which would strand `ForemanApp` on the stale `CORE_VIEWS`
  binding it imports through the roster.
- **Tolerating a same-fingerprint re-registration.** Any edit that changes the
  manifest — a view label, an accent, an added tab — changes the fingerprint. So
  the one edit most likely to re-execute the roster is precisely the one it
  would refuse to forgive.

Editing a **view** file is a different and already-fine path: view modules are
React components, react-refresh self-accepts them, and the update never reaches
the roster at all.

## Testing

Conventions, all visible in `victoria/shell.test.ts`, `victoria/geometry.test.ts`
and `polymarket/shell.test.tsx`:

**Import the roster, not a hand-built shell.** `import '../index.js'` registers
the shell exactly as `ForemanApp` does, so the assertions cover the real
registration path rather than an object that happens to look like one.

**Assert values, not shapes.** `expect(rows).toHaveLength(5)` passes while every
node type is wrong. Assert the actual step ids, labels, colours and paths:

```ts
expect(POLYMARKET_PIPELINE.map((s) => [s.stepId, s.name, s.nodeType])).toEqual([
  ['step_1', 'WeatherData', 'WEATHER_ENSEMBLE'],
  /* … */
]);
```

**Test geometry as pure functions, to exact coordinates.** `linePath` returns a
string; assert the string. This catches an inverted y-axis, which "a `<path>`
rendered" never will.

**Render with `renderToStaticMarkup` when a view is static.** The repo has no
jsdom and no testing-library, and does not need them for a view with nothing to
click — `react-dom/server` gives you the text that reaches the operator with no
test environment to carry. Reach for a DOM only when there is interaction worth
driving; an e2e test is usually the better answer.

**Every shell carries the zero-requests test** (above) and a tab-derivation
test: the exact tab ids in order, `source: 'usecase'` on the shell's own, no
core tab shadowed, and `resolveViewId` falling back to Console when the shell's
tab is open on an objective that does not have it.

**Seed a fixture objective.** Add one to `scripts/seed-foreman-e2e.ts` carrying
your `useCase`, so the shell is reachable by clicking after `task db:seed:e2e`
and the tab, accent and empty states are exercised by the e2e suite. Say in the
comment what that objective is *for* — Victoria's exists partly to exercise the
unreachable-backend path (the fixture deliberately does not stand up omega),
Polymarket's to exercise the no-backend-at-all path.

Run them with `task test:web -- src/foreman/usecases`.

## Phase 2: growing a shell

Adding endpoints to a shell that already exists is a small, local change:

1. Add the endpoint's types and function to `<shell>/client.ts`, with a
   provenance comment naming the proto message or Go handler and the date.
2. Capture a real response from the running backend and write the client test
   against it.
3. Add a hook to `<shell>/hooks.ts` returning the standard `Async<T>` triple.
4. Add or extend a view, going through the shared `<Async>` renderer so loading,
   error and empty states stay consistent.
5. Add the view to the manifest's `views` with an `order`. If it is the shell's
   first backend, add the source to `dataSources` and the health dot appears on
   its own.

Nothing in `registry.ts`, `core.tsx`, the kit or `ForemanApp` changes.
If you find yourself needing to touch one of them, that is the signal to stop
and reconsider — most often it means a view wants something that belongs on
`state`, or wants `UseCaseViewProps` to widen, which it does not.

**Victoria's pending list** is the worked example of keeping the roadmap visible
in the doc rather than in a tracker, each item naming the missing endpoint
rather than the missing feature:

- **Gate board** — the six hard gates per run (PnL floor, regime parity,
  drawdown ceiling, trade-count floor, signal integrity, auto-apply audit). The
  data is written to `data/{version}_gate_result.json`; nothing serves it.
- **Conviction funnel** — the four-stage filter pipeline (time filter →
  agreement ratio → weighted conviction → regime/vol gate) with drop counts per
  stage. `/decision-traces` carries the raw per-cycle traces; the aggregate does
  not exist.
- **Forensics diff** — the per-symbol / per-conviction-bucket run comparison
  `omega.tools.forensics.run_diff` produces. `/compare` returns four scalar
  deltas and a PnL-only verdict.
- **Training-log narrative** — the run's own log as a readable timeline.
- **Richer run rows** — profit factor and max drawdown are in each
  `_results.json` but not in the `/versions` projection, and no endpoint exposes
  the raw file. `sharpe_ratio` is `0` for every row for the same reason.
- **MAE/MFE per trade** — recorded nowhere today. `sit_out_reason` exists only
  per *cycle* on the progress record, not per trade.

**Polymarket's list** is larger, because the whole backend is missing: a Connect
service or REST routes exposing the markets being tracked, the model-probability
vs market-price edges `edge_detection.py` computes, the GEFS ensemble behind each
exceedance probability, and a bet ledger measuring `edge_accuracy` and
`avg_edge` against their configured targets. Until then the shell says so.

