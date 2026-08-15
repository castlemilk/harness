import { describe, expect, it } from 'vitest';
import { layoutGraph } from './graph-layout.js';
import type { Harness, Objective } from '../types.js';

const objective: Objective = {
  id: 'obj',
  name: 'Ship v3 integrations',
  progress: 0.62,
  ticketsTotal: 47,
  ticketsDone: 29,
  daysLeft: 6,
  spendToday: 41.2,
  spendTotal: 268.4,
  spendCap: 400,
  phases: [],
  stats: {
    running: 18,
    runningDelta: null,
    blocked: 3,
    blockedNeedingYou: 2,
    mergedToday: 7,
    awaitingReview: 4,
  },
};

function harness(id: string, parentId: string | null): Harness {
  return {
    id,
    name: id,
    parentId,
    objectiveId: 'obj',
    workstreamId: 'ws',
    status: 'working',
    activity: '',
    mission: '',
    currentJob: '',
    model: 'opus-4.6',
    contextUsed: 0.5,
    spend: 1,
    spendCap: 5,
    subtreeSpend: 1,
    heartbeatMinutes: 30,
    nextPulseInMinutes: 10,
    childCount: 0,
    maxChildren: 3,
    idleMinutes: 1,
    latestPulseSeq: 1,
    recentPulses: [],
    routine: [],
    playbookId: null,
    branch: null,
    ticketId: null,
  };
}

/** Every pair of nodes sharing a row must be horizontally disjoint. */
function overlaps(nodes: { x: number; width: number; y: number; height: number; id: string }[]) {
  const hits: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const sameRow = a.y < b.y + b.height && b.y < a.y + a.height;
      const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
      if (sameRow && xOverlap) hits.push(`${a.id} ∩ ${b.id}`);
    }
  }
  return hits;
}

describe('layoutGraph', () => {
  it('keeps a lone root and its single child disjoint', () => {
    const nodes = layoutGraph(objective, [harness('a', null), harness('a1', 'a')], new Set()).nodes;
    expect(overlaps(nodes)).toEqual([]);
  });

  it('does not overlap sibling roots that each have one child', () => {
    // The regression: a depth-0 node (190px) is wider than a depth-1 node
    // (130px), so centring the parent pulls it left into its left sibling.
    const harnesses = [
      harness('a', null),
      harness('a1', 'a'),
      harness('b', null),
      harness('b1', 'b'),
      harness('c', null),
      harness('c1', 'c'),
    ];
    expect(overlaps(layoutGraph(objective, harnesses, new Set()).nodes)).toEqual([]);
  });

  it('handles a deep chain, a wide fan-out and a single node', () => {
    const chain = [harness('r', null)];
    for (let i = 1; i < 6; i++) chain.push(harness(`d${String(i)}`, i === 1 ? 'r' : `d${String(i - 1)}`));
    expect(overlaps(layoutGraph(objective, chain, new Set()).nodes)).toEqual([]);

    const fan = [harness('lead', null)];
    for (let i = 0; i < 12; i++) fan.push(harness(`w${String(i)}`, 'lead'));
    expect(overlaps(layoutGraph(objective, fan, new Set()).nodes)).toEqual([]);

    expect(overlaps(layoutGraph(objective, [harness('solo', null)], new Set()).nodes)).toEqual([]);
  });

  it('keeps every node on the canvas and inside the reported bounds', () => {
    const harnesses = [
      harness('a', null),
      harness('a1', 'a'),
      harness('a2', 'a'),
      harness('a1x', 'a1'),
      harness('b', null),
      harness('b1', 'b'),
    ];
    const { nodes, width, height } = layoutGraph(objective, harnesses, new Set());
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(width);
      expect(n.y + n.height).toBeLessThanOrEqual(height);
    }
  });

  it('collapsing a parent hides its descendants without overlapping', () => {
    const harnesses = [
      harness('a', null),
      harness('a1', 'a'),
      harness('a2', 'a'),
      harness('b', null),
      harness('b1', 'b'),
    ];
    const { nodes } = layoutGraph(objective, harnesses, new Set(['a']));
    expect(nodes.map((n) => n.id)).not.toContain('a1');
    expect(overlaps(nodes)).toEqual([]);
  });
});
