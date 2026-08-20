import type { ComponentType } from 'react';
import type { ObjectiveState } from './state.js';
import type { UseCaseDataSourceConfig } from './data-source.js';

/**
 * The use-case plugin contract.
 *
 * Foreman has two axes. The *presentation* axis is the core chrome — Console,
 * Board, Graph, Work, Usage, Playbooks — which every objective gets regardless
 * of what it is doing. The *domain* axis is the use case: what this particular
 * objective is FOR (trading a book, triaging support, shipping a feature), which
 * brings its own vocabulary, its own accent, and its own extra tabs.
 *
 * A shell is a **pure export**: a module that exports a `UseCaseShell` object
 * and does nothing else at import time — no registration, no fetching, no
 * side effects. Registration is the host's job; the harness collects the
 * exported objects into a roster and registers them in one place, so a shell
 * can be published from another repository and still cost exactly one map
 * insert when the app starts.
 *
 * Nothing in this package imports the harness. That is the point: a plugin
 * depends on the kit, the kit depends on nothing but React's types, and the
 * harness depends on both.
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
  /**
   * The shell's own version, as its package declares it — `"0.1.0"`.
   *
   * Self-description, not machinery: nothing resolves, compares or gates on it.
   * The harness's Plugins surface renders it so an operator looking at a tab
   * can say *which* build of a plugin produced it, which matters most for the
   * out-of-tree shells whose source lives in another repository and moves on
   * its own schedule. Omit it and the surface simply shows no version.
   *
   * Hardcode the string that its `package.json` carries rather than reading the
   * file: a shell is a pure export with no runtime fs, and its manifest has to
   * stay importable from a browser bundle.
   */
  version?: string;
  /**
   * One line saying what this use case is for, in an operator's words.
   *
   * Rendered on the Plugins surface under the name. It answers "should an
   * objective of mine carry this?" — so describe the domain and what the tabs
   * show, not the implementation. A stub should say it is a stub.
   */
  description?: string;
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
