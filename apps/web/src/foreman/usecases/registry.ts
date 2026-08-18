import type { UseCaseShell, UseCaseView } from '@omega-harness/usecase-kit';

/**
 * The use-case registry — the host half of the plugin seam.
 *
 * The *contract* lives in `@omega-harness/usecase-kit`: `UseCaseShell`, the
 * view props, the vocabulary, the data-source transport. That package is what a
 * shell depends on, in this repository or another one. This module is what the
 * harness does with the shells it is given, and it deliberately stays here —
 * the map of registered shells is host state, not contract, and a plugin has no
 * business being able to read or mutate it.
 *
 * Registration is eager and static: the roster in `./index.ts` hands
 * `registerRoster` a flat list of exported shell objects at module load. There
 * is no dynamic import, no plugin discovery and no network fetch, so a missing
 * shell is a build error in the roster rather than a blank tab at runtime. A
 * shell never registers itself — it exports an object and nothing else.
 */

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

/**
 * Unwind a registration. Exists for tests; nothing in the app calls it.
 *
 * It also drops the id from `rosterIds`, because leaving it there means the
 * next `registerRoster` pass deletes whatever now holds that id — including a
 * shell someone else registered afterwards, which is exactly the eviction the
 * provenance list exists to prevent.
 */
export function unregisterUseCase(id: string): boolean {
  rosterIds = rosterIds.filter((rosterId) => rosterId !== id);
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
 *
 * It is also the ONLY registration path in the app: shells are pure exports, so
 * nothing is in the map that this function did not put there.
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
