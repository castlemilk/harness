# @omega-harness/usecase-kit

The use-case plugin contract for Foreman.

Foreman has two axes. The **presentation** axis is the core chrome — Console,
Board, Graph, Work, Usage, Playbooks — which every objective gets. The
**domain** axis is the use case: what an objective is *for* (trading a book,
triaging support, shipping a feature). A use-case shell is the domain axis: a
name, an accent, an optional vocabulary, some extra tabs, and the backends those
tabs read.

This package is everything a shell may know about the harness, and nothing else.
It imports nothing from the harness — a plugin depends on the kit, the kit
depends on React's *types* alone, and the harness depends on both.

## What is in it

| Export | What it is |
| --- | --- |
| `UseCaseShell`, `UseCaseView`, `UseCaseViewProps`, `Vocabulary` | The manifest and the view contract |
| `ObjectiveState` and its constituents (`Objective`, `Harness`, `Pulse`, `Workstream`, `Intervention`, `Ticket`, `ActivityEntry`, …) | The wire shapes `props.state` is made of |
| `createDataSource`, `resolveBaseUrl`, `DataSourceError`, `UseCaseDataSourceConfig`, `UseCaseDataSource`, `ProbeResult`, `SseOptions` | The transport a shell reaches its own backend with |

What is deliberately **not** in it: the registry (host state), the health-probe
machinery and dots (host chrome), the vocabulary provider (host rendering), the
core views' context, Foreman's own API client, and any domain formatting. A
shell's trading formatters, charts and typed client belong to the shell.

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

`react` (>=18), for types only — `UseCaseView.component` is a
`ComponentType<UseCaseViewProps>`. The kit itself imports no React runtime, so a
shell brings its own React and the host's copy is the one that renders it.

## Consuming it from another repository

The kit builds to `dist/` and is consumed through its exports map.

Inside this monorepo:

```jsonc
// package.json
"dependencies": { "@omega-harness/usecase-kit": "workspace:*" }
```

From a foreign repo, before the package is published, point at a checkout:

```jsonc
"dependencies": { "@omega-harness/usecase-kit": "file:../harness/packages/usecase-kit" }
```

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
  accent: '#7c8cf8',
  views: [{ id: 'example-view', label: 'Example', order: 10, component: ExampleView }],
};
```

`src/example-plugin.test.ts` is that shell as a compile-checked test: it imports
only the kit, and any change here that would break a conforming plugin fails
there rather than in a repository this one cannot see.
