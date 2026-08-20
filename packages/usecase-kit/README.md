# @omega-harness/usecase-kit

The use-case plugin contract for Foreman.

Foreman has two axes. The **presentation** axis is the core chrome — Console,
Board, Graph, Work, Usage, Playbooks — which every objective gets. The
**domain** axis is the use case: what an objective is *for* (trading a book,
triaging support, shipping a feature). A use-case shell is the domain axis: a
name, an accent, an optional vocabulary, some extra tabs, and the backends those
tabs read.

This package is everything a shell may know about the harness, and nothing else.
It imports nothing from the harness — a plugin depends on the kit, and the
harness depends on both.

## What is in it

Two entry points, and the split is the point: the root is types and transport
and pulls in no React runtime, so anything that needs only the contract pays
nothing for the components.

### `@omega-harness/usecase-kit` — the contract

| Export | What it is |
| --- | --- |
| `UseCaseShell`, `UseCaseView`, `UseCaseViewProps`, `Vocabulary` | The manifest and the view contract |
| `ObjectiveState` and its constituents (`Objective`, `Harness`, `Pulse`, `Workstream`, `Intervention`, `Ticket`, `ActivityEntry`, …) | The wire shapes `props.state` is made of |
| `createDataSource`, `resolveBaseUrl`, `DataSourceError`, `UseCaseDataSourceConfig`, `UseCaseDataSource`, `ProbeResult`, `SseOptions` | The transport a shell reaches its own backend with |

### `@omega-harness/usecase-kit/ui` — the shared presentation

React components, so this entry is where the runtime dependency lives.

| Export | What it is |
| --- | --- |
| `Panel` | the bordered surface every domain block is |
| `Pill` | the status/label chip, tinted from a colour you pass |
| `SectionLabel` | the mono micro-heading over every block |
| `StatusDot` | a harness's state as a mark; live states breathe |
| `statusColor`, `statusTextClass` | the decision `StatusDot` is drawn from, and the chrome's too |
| `clock`, `ago`, `duration`, `elapsed` | time formatting. Absent or unparseable renders as an em dash, never a zero |

They are here because a shell outside the harness repo cannot import the app's
`ui/primitives.tsx` by relative path, and the alternative — a copy of "what a
panel looks like" per plugin — is how a plugin seam becomes six design systems.
The app re-exports them, so there is one definition.

Their styling is Tailwind classes from the harness palette (`bg-panel`,
`border-line`, `text-faint`). That is contract, not implementation detail: a
plugin renders inside the harness's stylesheet, and the harness's
`tailwind.config.js` scans this package's source *and* every configured plugin
directory so those classes survive the purge.

What is deliberately **not** in it: the registry (host state), the health-probe
machinery and dots (host chrome), the vocabulary provider (host rendering), the
core views' context, Foreman's own API client, and any domain formatting. A
shell's trading formatters, charts and typed client belong to the shell — and so
do its charts: `PulseSparkline`, `ContextRing`, `Meter`, `Avatar` and `Button`
stayed in the app because they draw Foreman's own concepts or carry behaviour
the host owns. This is not a design system and should not become one; the test
for adding something is "the chrome and two shells all need it and would
otherwise copy it".

## The rules

**Pure exports.** A shell module exports a `UseCaseShell` object and does
nothing else at import time — no `registerUseCase`, no fetching, no side
effects. Registration is the host's: the harness collects exported shells into
one roster and registers them in one place. A shell that registers itself cannot
be tree-shaken, cannot be tested without the app, and turns import order into
behaviour.

The convention is a **named export** (`export const victoriaUseCase:
UseCaseShell = { … }`), not a default — a named export survives a barrel file
and reads honestly in the roster.

**The manifest does not fetch.** A registered shell that no objective has
selected must cost zero requests. Build the client at module scope if you like,
but call it only from a view.

**`UseCaseViewProps` never widens.** Six fields, forever: `objectiveId`,
`state`, `focusId`, `onFocus`, `onOpenView`, `mutate`. Domain data comes from
the shell's own typed client (`createDataSource`), not from the host. If a shell
needs something more, derive it from `state` — a seventh field is a change to
every plugin that exists.

**The host owns the env.** A source's `envVar` (by convention
`VITE_UC_<ID>_URL`) is resolved out of a bag the host hands over once with
`setUseCaseEnv(import.meta.env)`. The kit cannot read `import.meta.env` for
itself: it ships pre-built `dist/`, and Vite only substitutes that in the source
it compiles — a bare `import.meta.env` in here survives into the bundle
unreplaced and evaluates to `undefined`, which would silently pin every shell to
its declared `baseUrl`. `setUseCaseEnv` is the host's to call and a plugin's
never to. Resolution is lazy, so a client built at module scope still sees the
bag.

**Declaring a data source buys chrome, not data.** The host probes each declared
source while the shell is active and shows a health dot, so "the tab is empty"
and "the backend is down" are distinguishable. It never learns your endpoints,
types or auth.

## Peer dependencies

`react` (>=18). The root entry needs it for types alone —
`UseCaseView.component` is a `ComponentType<UseCaseViewProps>` — while `/ui` is
real components compiled with the automatic JSX runtime. Either way the kit
brings no React of its own: the host's copy is the one that renders everything.

If you consume this from another repository, that is a thing to get right rather
than assume. Node resolves `react` from *your* directory, so a plugin repo with
React installed for its own tests can put a second React in the page and every
hook in your shell will throw. The harness's `vite.config.ts` dedupes
`react`/`react-dom` and aliases both of this package's entry points to its own
build for exactly this reason.

## Consuming it from another repository

The kit builds to `dist/` and is consumed through its exports map.

Inside this monorepo:

```jsonc
// package.json
"dependencies": { "@omega-harness/usecase-kit": "workspace:*" }
```

From a foreign repo, before the package is published, point at a checkout — this
is what `omega/foreman-plugins/{victoria,polymarket}` do:

```jsonc
"dependencies": { "@omega-harness/usecase-kit": "file:../../harness/packages/usecase-kit" }
```

That dependency is what gives the foreign repo's editor and `tsc` the contract.
It is **not** what the bundle resolves: the harness builds the plugin, and it
aliases this package name to its own workspace copy so there is exactly one kit
(and one `setUseCaseEnv` bag) in the graph.

Either way the consumer resolves through `dist/`, so **rebuild the kit after
changing it** (`pnpm --filter @omega-harness/usecase-kit build`) or the
consumer keeps typechecking against the previous contract.

## The smallest conforming shell

```ts
import type { UseCaseShell, UseCaseViewProps } from '@omega-harness/usecase-kit';

function ExampleView({ state }: UseCaseViewProps) {
  return <p>{state.harnesses.length} harnesses on {state.objective.name}</p>;
}

export const exampleUseCase: UseCaseShell = {
  id: 'example',                    // matches Objective.useCase on the server
  name: 'Example — a domain shell',
  version: '0.1.0',                 // optional; what your package.json says
  description: 'One line an operator can read.',
  accent: '#7c8cf8',
  views: [{ id: 'example-view', label: 'Example', order: 10, component: ExampleView }],
};
```

### Self-description: `version` and `description`

Both are optional and neither is machinery — nothing resolves, compares or
gates on either. They exist because the harness has a **Plugins** surface that
lists every registered shell, and a plugin that cannot say what it is or which
build it came from leaves an operator reading source paths. `version` should be
the literal string its `package.json` carries (hardcoded — a manifest is a pure
export and must not touch the filesystem); `description` is one line about the
domain, and an honest one if the shell is a stub.

`src/example-plugin.test.ts` is that shell as a compile-checked test: it imports
only the kit, and any change here that would break a conforming plugin fails
there rather than in a repository this one cannot see. `src/ui/ui.test.tsx` does
the same job for `/ui`, asserting the exact class names and colours the
components emit — those strings are what an out-of-tree shell is depending on,
so "it rendered a span" would pass while every plugin quietly stopped matching
the app.

The real shells are in the omega repo (`foreman-plugins/`); the harness's
`docs/USE-CASE-SHELLS.md` is the long-form guide.
