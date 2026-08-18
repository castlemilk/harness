import type { ObjectiveState } from './api.js';
import type { Harness, Intervention, Pulse, Workstream } from '../types.js';

/**
 * The adapter layer.
 *
 * Foreman's server serialises the view model directly — the wire shape IS
 * `ObjectiveState`, so there is no field-by-field mapping to do here and adding
 * one would only be a second place to keep in sync. What this module owns is
 * the other half of an adapter's job:
 *
 *   1. The BOUNDARY CHECKS. Everything downstream — three shells, the surfaces,
 *      every use-case view — indexes into arrays and does arithmetic on numbers
 *      straight off the wire. A malformed payload (a proxy returning HTML, a
 *      half-written SSE frame, a server regression that nulls a column) used to
 *      flow in silently and surface as a render crash or, worse, a
 *      plausible-looking `NaN`. State enters the app by four doors and each one
 *      has a projector here: `projectObjectiveState` for a whole snapshot (the
 *      fetch and the SSE `init` frame), and `projectHarnessPatch`,
 *      `projectPulse` and `projectIntervention` for the three per-entity SSE
 *      patches. No door is unguarded.
 *   2. The PATCH APPLIERS (`applyHarnessPatch`, `applyPulse`,
 *      `applyIntervention`): how a validated patch folds into the state the
 *      shells hold. Pure and React-free, so the merge rules — which are where
 *      "a harness spawned by another client" used to arrive half-formed — are
 *      testable without a renderer.
 *   3. The PROJECTIONS: pure functions that turn the flat wire lists into what a
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
 * Validate a whole-state wire payload and hand back what the shells render.
 *
 * Called on both paths a *snapshot* can arrive by — the fetched state and the
 * SSE `init` frame. The per-entity SSE patches go through the projectors below
 * instead. Throws with the offending field named, because "cannot read
 * properties of undefined" three components deep is how this used to be
 * reported.
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

/** How many pulses a harness keeps client-side; matches the server's window. */
const RECENT_PULSE_CAP = 12;

/**
 * Validate an SSE `harness` patch.
 *
 * A patch is not a partial in practice — the server sends a whole serialised
 * harness — but it is a patch in *effect*: for a harness the client already has
 * it merges, and for one it has never seen (another operator spawned it while
 * this client was watching) it is appended whole. That second case is the one
 * that bit: the patch used to be cast straight to `Harness`, so a payload
 * missing `recentPulses` appended an entry whose array-valued fields were
 * `undefined`, and the next render — or the next pulse frame — threw inside
 * `.map`/`.filter` with nothing pointing at the frame that caused it.
 *
 * So the two list fields every shell walks are defaulted to empty rather than
 * trusted: `recentPulses`, which the stream now sends, and `routine`, which it
 * does not (it needs a playbook join the stream deliberately doesn't do — an
 * appended harness shows no routine until the next full refresh, which is a
 * missing detail rather than a crash).
 */
export function projectHarnessPatch(wire: unknown): Harness {
  const harness = record(wire, 'harness patch');
  id(harness.id, 'harness patch id');
  finite(harness.spend, `harness patch ${String(harness.id)}.spend`);
  if (harness.recentPulses === undefined) harness.recentPulses = [];
  array(harness.recentPulses, `harness patch ${String(harness.id)}.recentPulses`);
  if (harness.routine === undefined) harness.routine = [];
  array(harness.routine, `harness patch ${String(harness.id)}.routine`);
  return harness as unknown as Harness;
}

export interface PulsePatch {
  harnessId: string;
  pulse: Pulse;
}

/** Validate an SSE `pulse` frame: which harness, and a pulse with an id and seq. */
export function projectPulse(wire: unknown): PulsePatch {
  const frame = record(wire, 'pulse frame');
  const harnessId = id(frame.harnessId, 'pulse frame harnessId');
  const pulse = record(frame.pulse, 'pulse frame pulse');
  id(pulse.id, 'pulse frame pulse.id');
  // The seq drives `latestPulseSeq`, which renders as "#204" and sorts the list.
  finite(pulse.seq, 'pulse frame pulse.seq');
  return { harnessId, pulse: pulse as unknown as Pulse };
}

/** An intervention patch carries a status the wire model itself doesn't have. */
export type InterventionPatch = Intervention & { status?: string };

export function projectIntervention(wire: unknown): InterventionPatch {
  const item = record(wire, 'intervention patch');
  id(item.id, 'intervention patch id');
  id(item.harnessId, `intervention patch ${String(item.id)}.harnessId`);
  return item as unknown as InterventionPatch;
}

// ─── Patch appliers ──────────────────────────────────────────────────────────

/**
 * Fold a harness patch into the fleet: merge onto the known one, append a new.
 *
 * `recentPulses` is the one field the merge does not take blindly. The stream's
 * pulse window is narrower than the snapshot's, so a quiet harness patches in
 * with an empty list — taking it would erase pulse history the operator can see
 * on screen. An empty patch list therefore means "nothing recent", not "nothing
 * ever", and the known list wins. For an appended harness there is nothing to
 * preserve, so the patch's list (already defaulted) is what it starts with.
 */
export function applyHarnessPatch(state: ObjectiveState, patch: Harness): ObjectiveState {
  const known = state.harnesses.some((h) => h.id === patch.id);
  return {
    ...state,
    harnesses: known
      ? state.harnesses.map((h) =>
          h.id === patch.id
            ? {
                ...h,
                ...patch,
                recentPulses: patch.recentPulses.length > 0 ? patch.recentPulses : h.recentPulses,
                routine: patch.routine.length > 0 ? patch.routine : h.routine,
              }
            : h,
        )
      : [...state.harnesses, patch],
  };
}

/** Put a pulse at the head of its harness's list, replacing any earlier copy. */
export function applyPulse(state: ObjectiveState, { harnessId, pulse }: PulsePatch): ObjectiveState {
  return {
    ...state,
    harnesses: state.harnesses.map((h) =>
      h.id === harnessId
        ? {
            ...h,
            latestPulseSeq: pulse.seq,
            recentPulses: [pulse, ...h.recentPulses.filter((p) => p.id !== pulse.id)].slice(
              0,
              RECENT_PULSE_CAP,
            ),
          }
        : h,
    ),
  };
}

/** A resolved intervention leaves the queue; a pending one replaces its entry. */
export function applyIntervention(state: ObjectiveState, item: InterventionPatch): ObjectiveState {
  const resolved = item.status !== undefined && item.status !== 'pending';
  const without = state.interventions.filter((i) => i.id !== item.id);
  return {
    ...state,
    interventions: resolved ? without : [...without, item],
  };
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
