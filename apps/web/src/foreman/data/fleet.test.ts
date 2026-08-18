import { describe, expect, it } from 'vitest';
// The projections moved to the adapter seam; `useForeman` re-exports them for
// the shells, but the tests follow the code.
import { buildTree, flattenTree, groupByWorkstream, liveHarnesses } from './adapt.js';
import { capRatio, clamp01 } from '../ui/primitives.js';
import { duration, money, percent } from '../ui/format.js';
import type { Harness, HarnessStatus, Workstream } from '../types.js';

/**
 * Core domain for the Foreman shells: how a flat harness list becomes a tree,
 * how the fleet is grouped into lanes, and the numeric helpers that feed CSS
 * widths. Everything here has bitten us at least once.
 */

function harness(
  id: string,
  parentId: string | null,
  extra: Partial<Harness> = {},
): Harness {
  return {
    id,
    name: id,
    parentId,
    objectiveId: 'obj',
    workstreamId: 'ws-1',
    status: 'working' as HarnessStatus,
    activity: '',
    mission: '',
    currentJob: '',
    model: 'gpt-5',
    contextUsed: 0.2,
    spend: 1,
    spendCap: 5,
    subtreeSpend: 1,
    heartbeatMinutes: 30,
    nextPulseInMinutes: 5,
    childCount: 0,
    maxChildren: 3,
    idleMinutes: null,
    latestPulseSeq: 1,
    recentPulses: [],
    routine: [],
    playbookId: null,
    branch: null,
    ticketId: null,
    ...extra,
  };
}

function workstream(id: string, extra: Partial<Workstream> = {}): Workstream {
  return {
    id,
    name: id,
    leadHarnessId: null,
    status: 'working',
    agentCount: 0,
    spend: 0,
    paused: false,
    pausedNote: null,
    ...extra,
  };
}

describe('buildTree', () => {
  it('nests children under their parent at increasing depth', () => {
    const tree = buildTree([
      harness('lead', null),
      harness('worker', 'lead'),
      harness('grandchild', 'worker'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].harness.id).toBe('lead');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].harness.id).toBe('worker');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('promotes a harness whose parent is missing to a root', () => {
    // A filtered or partial payload must not hide part of the fleet.
    const tree = buildTree([harness('orphan', 'not-in-payload')]);
    expect(tree.map((n) => n.harness.id)).toEqual(['orphan']);
  });

  it('still renders every harness when the parent links form a cycle', () => {
    // Every node has a present parent, so there is no natural root: without
    // cycle handling the whole fleet would silently disappear.
    const tree = buildTree([harness('a', 'b'), harness('b', 'a')]);
    const seen = new Set<string>();
    const walk = (nodes: ReturnType<typeof buildTree>) => {
      for (const n of nodes) {
        seen.add(n.harness.id);
        walk(n.children);
      }
    };
    walk(tree);
    expect(seen).toEqual(new Set(['a', 'b']));
  });
});

describe('flattenTree', () => {
  const tree = buildTree([harness('lead', null), harness('worker', 'lead')]);

  it('hides children of a collapsed node', () => {
    expect(flattenTree(tree, new Set()).map((r) => r.node.harness.id)).toEqual(['lead']);
  });

  it('reveals them when expanded, and reports which rows have children', () => {
    const rows = flattenTree(tree, new Set(['lead']));
    expect(rows.map((r) => r.node.harness.id)).toEqual(['lead', 'worker']);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[1].hasChildren).toBe(false);
  });
});

describe('groupByWorkstream', () => {
  const streams = [workstream('ws-1'), workstream('ws-2')];

  it('buckets harnesses under their workstream', () => {
    const groups = groupByWorkstream(
      [harness('a', null), harness('b', null, { workstreamId: 'ws-2' })],
      streams,
    );
    expect(groups.map((g) => g.harnesses.map((h) => h.id))).toEqual([['a'], ['b']]);
  });

  it('surfaces harnesses with no or an unknown workstream instead of dropping them', () => {
    // A freshly spawned top-level harness looks exactly like this.
    const groups = groupByWorkstream(
      [harness('a', null, { workstreamId: null }), harness('b', null, { workstreamId: 'gone' })],
      streams,
    );
    const unassigned = groups.find((g) => g.workstream === null);
    expect(unassigned?.name).toBe('Unassigned');
    expect(unassigned?.harnesses.map((h) => h.id).sort()).toEqual(['a', 'b']);
  });

  it('excludes retired harnesses from the fleet', () => {
    const fleet = [harness('a', null), harness('old', null, { status: 'retired' })];
    expect(liveHarnesses(fleet).map((h) => h.id)).toEqual(['a']);
    const groups = groupByWorkstream(fleet, streams);
    expect(groups.flatMap((g) => g.harnesses.map((h) => h.id))).toEqual(['a']);
  });
});

describe('numeric helpers', () => {
  it('clamps fractions that would otherwise become invalid CSS widths', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.8)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('refuses to express a ratio against a cap that cannot carry one', () => {
    // Returning 0 here would draw an empty meter, which reads as "nothing
    // spent" — the opposite of a blown budget.
    expect(capRatio(5, 10)).toBe(0.5);
    expect(capRatio(15, 10)).toBe(1.5);
    expect(capRatio(5, 0)).toBeNull();
    expect(capRatio(5, null)).toBeNull();
    expect(capRatio(Number.NaN, 10)).toBeNull();
  });

  it('formats money, percentages and durations the way the shells expect', () => {
    expect(money(1.02)).toBe('$1.02');
    expect(money(Number.NaN)).toBe('$0.00');
    expect(percent(0.561)).toBe('56%');
    expect(percent(2)).toBe('100%');
    expect(duration(4)).toBe('4m');
    expect(duration(66)).toBe('1.1h');
    expect(duration(13 * 60)).toBe('13h');
    expect(duration(null)).toBe('—');
  });
});
