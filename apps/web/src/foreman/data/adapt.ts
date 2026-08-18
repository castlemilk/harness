import type { ObjectiveState } from './api.js';
import type { Harness, Workstream } from '../types.js';

/**
 * The adapter layer.
 *
 * Foreman's server serialises the view model directly — the wire shape IS
 * `ObjectiveState`, so there is no field-by-field mapping to do here and adding
 * one would only be a second place to keep in sync. What this module owns is
 * the other half of an adapter's job:
 *
 *   1. The BOUNDARY CHECK (`projectObjectiveState`). Everything downstream —
 *      three shells, the surfaces, every use-case view — indexes into arrays and
 *      does arithmetic on numbers straight off the wire. A malformed payload
 *      (a proxy returning HTML, a half-written SSE frame, a server regression
 *      that nulls a column) used to flow in silently and surface as a render
 *      crash or, worse, a plausible-looking `NaN`. The projector asserts the
 *      invariants the shells actually rely on, at the one place state enters.
 *   2. The PROJECTIONS: pure functions that turn the flat wire lists into what a
 *      view renders — the harness tree, the workstream lanes, the live fleet.
 *      They live here rather than in `useForeman` so they are reachable (and
 *      testable) without React.
 *
 * This is deliberately NOT a schema validator. Validating every field would
 * duplicate `types.ts` in a second dialect and drift from it; the point is to
 * fail loudly on the load-bearing invariants — arrays are arrays, ids are
 * strings, money is a finite number — and let the rest be TypeScript's problem.
 */

// ─── Boundary check ──────────────────────────────────────────────────────────

function fail(what: string): never {
  throw new Error(`Foreman state is malformed: ${what}`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  return value;
}

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') fail(`${what} must be a non-empty string`);
  return value;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Validate a wire payload and hand back the state the shells render.
 *
 * Called on both paths state can arrive by — the fetched snapshot and the SSE
 * `init` frame — so there is exactly one door. Throws with the offending field
 * named, because "cannot read properties of undefined" three components deep is
 * how this used to be reported.
 */
export function projectObjectiveState(wire: unknown): ObjectiveState {
  const state = record(wire, 'state');

  const objective = record(state.objective, 'objective');
  id(objective.id, 'objective.id');
  id(objective.name, 'objective.name');
  // Spend drives meters and cap ratios; a NaN here draws a silently empty bar.
  finite(objective.spendToday, 'objective.spendToday');
  finite(objective.spendTotal, 'objective.spendTotal');

  for (const key of ['workstreams', 'harnesses', 'interventions', 'tickets', 'activity'] as const) {
    array(state[key], key);
  }

  const harnesses = state.harnesses as unknown[];
  for (const [i, entry] of harnesses.entries()) {
    const harness = record(entry, `harnesses[${String(i)}]`);
    id(harness.id, `harnesses[${String(i)}].id`);
    finite(harness.spend, `harnesses[${String(i)}].spend`);
    // Pulses are sliced and mapped by every shell; a non-array is a render crash.
    array(harness.recentPulses, `harnesses[${String(i)}].recentPulses`);
  }

  return state as unknown as ObjectiveState;
}

// ─── Projections ─────────────────────────────────────────────────────────────

/** A harness plus its resolved children, for the tree and graph shells. */
export interface HarnessNode {
  harness: Harness;
  children: HarnessNode[];
  depth: number;
}

/**
 * Rebuild the hierarchy from the flat list. Harnesses whose parent isn't in the
 * payload are surfaced as roots rather than dropped, so a partial fetch never
 * silently hides part of the fleet. Cycles are broken by visit-tracking.
 */
export function buildTree(harnesses: Harness[]): HarnessNode[] {
  const byId = new Map(harnesses.map((h) => [h.id, h]));
  const childrenOf = new Map<string | null, Harness[]>();
  for (const h of harnesses) {
    const key = h.parentId && byId.has(h.parentId) ? h.parentId : null;
    const list = childrenOf.get(key);
    if (list) list.push(h);
    else childrenOf.set(key, [h]);
  }

  const seen = new Set<string>();
  const build = (harness: Harness, depth: number): HarnessNode => {
    seen.add(harness.id);
    const kids = (childrenOf.get(harness.id) ?? []).filter((c) => !seen.has(c.id));
    return { harness, depth, children: kids.map((c) => build(c, depth + 1)) };
  };

  const roots = (childrenOf.get(null) ?? []).map((h) => build(h, 0));

  // A parent/child cycle leaves every node with a present parent, so the null
  // bucket is empty and nothing would render. Promote the unreached to roots.
  for (const h of harnesses) {
    if (!seen.has(h.id)) roots.push(build(h, 0));
  }

  return roots;
}

/** Flatten a tree honouring which nodes are expanded, for virtualised rows. */
export function flattenTree(
  nodes: HarnessNode[],
  expanded: Set<string>,
): { node: HarnessNode; hasChildren: boolean }[] {
  const out: { node: HarnessNode; hasChildren: boolean }[] = [];
  const walk = (list: HarnessNode[]) => {
    for (const n of list) {
      out.push({ node: n, hasChildren: n.children.length > 0 });
      if (n.children.length > 0 && expanded.has(n.harness.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export interface FleetGroup {
  id: string;
  name: string;
  /** Null for the synthetic bucket holding harnesses with no workstream. */
  workstream: Workstream | null;
  harnesses: Harness[];
}

export const UNASSIGNED_GROUP = '__unassigned';

/**
 * Group the fleet for the tree, roster and lanes.
 *
 * Rendering by iterating workstreams alone drops any harness whose
 * `workstreamId` is null or dangling — which is exactly what a freshly spawned
 * top-level harness looks like. Those land in an "Unassigned" bucket instead of
 * vanishing while still being counted. Retired harnesses are excluded outright.
 */
export function groupByWorkstream(
  harnesses: Harness[],
  workstreams: Workstream[],
): FleetGroup[] {
  const live = harnesses.filter((h) => h.status !== 'retired');
  const known = new Set(workstreams.map((w) => w.id));

  const groups: FleetGroup[] = workstreams.map((ws) => ({
    id: ws.id,
    name: ws.name,
    workstream: ws,
    harnesses: live.filter((h) => h.workstreamId === ws.id),
  }));

  const orphans = live.filter((h) => h.workstreamId == null || !known.has(h.workstreamId));
  if (orphans.length > 0) {
    groups.push({
      id: UNASSIGNED_GROUP,
      name: 'Unassigned',
      workstream: null,
      harnesses: orphans,
    });
  }

  return groups;
}

/** The fleet as the shells count it: everything except retired harnesses. */
export function liveHarnesses(harnesses: Harness[]): Harness[] {
  return harnesses.filter((h) => h.status !== 'retired');
}
