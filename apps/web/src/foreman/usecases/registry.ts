import type { ComponentType } from 'react';
import type { ObjectiveState } from '../data/api.js';
import type { UseCaseDataSourceConfig } from './data-source.js';

/**
 * Use-case shells.
 *
 * Foreman has two axes. The *presentation* axis is the core chrome — Console,
 * Board, Graph, Work, Usage, Playbooks — which every objective gets regardless
 * of what it is doing. The *domain* axis is the use case: what this particular
 * objective is FOR (trading a book, triaging support, shipping a feature), which
 * brings its own vocabulary, its own accent, and its own extra tabs.
 *
 * A use-case shell is the domain axis, registered at module load from the roster
 * in `./index.ts` and keyed by `Objective.useCase` on the server. Registration
 * is deliberately eager and static — there is no dynamic import, no plugin
 * discovery and no network fetch, so a missing shell is a build error in the
 * roster rather than a blank tab at runtime.
 */

/**
 * The contract a use-case view is handed. This is the plugin API surface, so it
 * is deliberately the *smallest* set that lets a domain view be useful:
 *
 *   - the objective it is rendering, by id and as resolved state
 *   - the harness in focus, and the ability to move focus
 *   - the ability to send the operator to another registered view
 *   - one funnel for mutations, so a domain view's failures surface in the same
 *     error rail as the core views' instead of being swallowed
 *
 * It is intentionally NOT the core views' context: those get privileged access
 * to Foreman internals (the tool list, the playbook draft, the usage window)
 * because they are the app. A use-case view is a guest, and everything it can
 * reach here is either already on the wire or a callback Foreman owns. Growing
 * this interface is a real API decision — prefer deriving from `state`.
 */
export interface UseCaseViewProps {
  /** The objective this view is scoped to. Never empty. */
  objectiveId: string;
  /** The same snapshot the core views render, straight off the wire. */
  state: ObjectiveState;
  /** The harness currently in focus across the app, or null. */
  focusId: string | null;
  /** Move focus. Passing null clears it. */
  onFocus: (harnessId: string | null) => void;
  /** Switch to another registered view by id — core or use-case. */
  onOpenView: (viewId: string) => void;
  /** Run a mutation; refreshes state on success, surfaces failures in the rail. */
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}

/** A tab a shell contributes, rendered inside the core Foreman chrome. */
export interface UseCaseView {
  /** Tab id, unique within the shell and distinct from every core view id. */
  id: string;
  label: string;
  component: ComponentType<UseCaseViewProps>;
  /** Lower sorts first. Views without one keep roster order, after those with. */
  order?: number;
}

/** Display terms a shell may rename. Anything omitted keeps the Foreman word. */
export type Vocabulary = Partial<Record<'harness' | 'pulse' | 'objective', string>>;

export interface UseCaseShell {
  /** Matches `Objective.useCase` on the server. Lowercase slug. */
  id: string;
  /** Human name, e.g. "Victoria — market trading". */
  name: string;
  /** CSS color driving `--uc-accent` while this shell is active. */
  accent?: string;
  vocabulary?: Vocabulary;
  /** Domain tabs ADDED to the core tabs — a shell never removes core chrome. */
  views: UseCaseView[];
  /**
   * Backends this shell reads from. Declaring one does NOT hand the shell's
   * views anything — a view builds its own typed client with
   * `createDataSource` (see `./data-source.ts`). What declaring buys is chrome:
   * while this shell is active Foreman probes each source and shows a health
   * dot, so "the domain tab is empty" and "the backend is down" are
   * distinguishable without opening devtools.
   */
  dataSources?: UseCaseDataSourceConfig[];
}

/** Same slug rule the server enforces on `POST /objectives`. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const shells = new Map<string, UseCaseShell>();

/**
 * Register a shell. Throws rather than overwriting: two shells claiming one id
 * means one of them silently never renders, which is far harder to find at
 * runtime than a stack trace at import time.
 */
export function registerUseCase(shell: UseCaseShell): void {
  if (!SLUG.test(shell.id)) {
    throw new Error(`Use-case id must be a lowercase slug: "${shell.id}"`);
  }
  if (shells.has(shell.id)) {
    throw new Error(`Use case "${shell.id}" is already registered`);
  }
  const seen = new Set<string>();
  for (const view of shell.views) {
    if (seen.has(view.id)) {
      throw new Error(`Use case "${shell.id}" registers view "${view.id}" twice`);
    }
    seen.add(view.id);
  }
  const sources = new Set<string>();
  for (const source of shell.dataSources ?? []) {
    // Two sources under one id means one dot silently replaces the other, and
    // the operator watches the health of a backend they aren't looking at.
    if (sources.has(source.id)) {
      throw new Error(`Use case "${shell.id}" declares data source "${source.id}" twice`);
    }
    sources.add(source.id);
  }
  shells.set(shell.id, shell);
}

/** Unwind a registration. Exists for tests; nothing in the app calls it. */
export function unregisterUseCase(id: string): boolean {
  return shells.delete(id);
}

/**
 * Ids the roster claimed on its last pass. Module-level, and deliberately NOT
 * derived from `shells` — the roster owns exactly what it registered, and must
 * not be able to evict a shell somebody else put in the map.
 */
let rosterIds: string[] = [];

/**
 * Register the whole roster, replacing the previous roster.
 *
 * This exists for Vite HMR. `shells` lives in *this* module, which is a
 * dependency of the roster rather than an importer of it, so it is not
 * re-executed when a shell file changes — but the roster is. Editing
 * `victoria/index.ts` invalidates it and every importer up to the nearest
 * accepting boundary (`ForemanApp.tsx`, self-accepting via react-refresh);
 * re-importing that boundary re-executes the roster against a `shells` map that
 * still holds the old entries, and `registerUseCase` throws "already
 * registered". The app then sits on a red overlay until a full reload.
 *
 * Two alternatives were rejected:
 *
 *   - **`import.meta.hot.dispose` in the roster.** Vite 5's client looks the
 *     disposer up as `disposeMap.get(acceptedPath)` (client.mjs, `fetchUpdate`),
 *     so it only fires for the module that *accepted* the update. That is
 *     `ForemanApp.tsx`, not the roster, so a roster disposer would simply never
 *     run — unless the roster self-accepted, which would strand ForemanApp on
 *     the stale `CORE_VIEWS` binding it imports through the roster.
 *   - **Tolerating a same-fingerprint re-registration.** Any edit that changes
 *     the manifest — a view label, an accent — changes the fingerprint, so the
 *     one edit most likely to re-execute the roster is the one it would not
 *     forgive.
 *
 * Replacing by *provenance* needs neither. The collision guarantee is untouched:
 * `registerUseCase` still throws on every duplicate, including two roster
 * entries claiming one id (the first is in the map by the time the second is
 * offered) and a roster entry colliding with a shell registered elsewhere.
 */
export function registerRoster(roster: readonly UseCaseShell[]): void {
  for (const id of rosterIds) shells.delete(id);
  rosterIds = [];
  for (const shell of roster) {
    // Push only after it lands, so a mid-roster throw leaves `rosterIds`
    // describing what is really in the map rather than what was intended.
    registerUseCase(shell);
    rosterIds.push(shell.id);
  }
}

/** The shell for an objective's `useCase`, or null when there isn't one. */
export function getUseCase(id: string | null | undefined): UseCaseShell | null {
  if (!id) return null;
  return shells.get(id) ?? null;
}

/** Every registered shell, in registration order. */
export function getUseCases(): UseCaseShell[] {
  return [...shells.values()];
}

/** The minimum a view needs to appear in the tab bar. */
export interface ViewDescriptor {
  id: string;
  label: string;
  order?: number;
}

export interface ViewTab {
  id: string;
  label: string;
  /** Core tabs are chrome; use-case tabs are the domain, and are tinted. */
  source: 'core' | 'usecase';
}

function byOrder<T extends ViewDescriptor>(views: readonly T[]): T[] {
  return [...views].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

/**
 * The tab bar for one objective: the core views, then the active shell's views.
 * Core always comes first and always survives — a use case extends the chrome,
 * it does not replace it.
 */
export function viewTabs(
  coreViews: readonly ViewDescriptor[],
  useCaseId?: string | null,
): ViewTab[] {
  const tabs: ViewTab[] = byOrder(coreViews).map((v) => ({ id: v.id, label: v.label, source: 'core' }));
  const shell = getUseCase(useCaseId);
  if (shell) {
    for (const view of byOrder(shell.views)) {
      // A shell that shadows a core id would make a core view unreachable.
      if (tabs.some((t) => t.id === view.id)) continue;
      tabs.push({ id: view.id, label: view.label, source: 'usecase' });
    }
  }
  return tabs;
}

/**
 * Resolve the view to render. The active view is a plain string that outlives
 * objective switches, so it can point at a tab that no longer exists (switching
 * away from a demo objective while its own tab is open). Falling back to the
 * first core view keeps the app on a real surface instead of a blank pane.
 */
export function resolveViewId(tabs: readonly ViewTab[], viewId: string): string {
  if (tabs.some((t) => t.id === viewId)) return viewId;
  const core = tabs.find((t) => t.source === 'core');
  return core?.id ?? viewId;
}

/** The component for a use-case view id, or null when it isn't one. */
export function findUseCaseView(useCaseId: string | null | undefined, viewId: string): UseCaseView | null {
  const shell = getUseCase(useCaseId);
  return shell?.views.find((v) => v.id === viewId) ?? null;
}
