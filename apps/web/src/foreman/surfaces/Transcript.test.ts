import { describe, expect, it } from 'vitest';
import { groupIdlePulses, visibleEntries } from './Transcript.js';
import type { TranscriptEntry } from '../types.js';

/**
 * The anti-noise rules, asserted as values: which entries a filter keeps, and
 * which pulse runs collapse. These are the two behaviours that turn a
 * heartbeat harness's transcript from a wall of dividers into a work log.
 */

const divider = (
  seq: number,
  overrides: Partial<Extract<TranscriptEntry, { kind: 'pulse-divider' }>> = {},
): TranscriptEntry => ({
  kind: 'pulse-divider',
  id: `p${String(seq)}`,
  seq,
  at: `2026-08-21T00:${String(seq).padStart(2, '0')}:00Z`,
  duration: '4s',
  cost: 0.1,
  summary: null,
  outcome: 'ok',
  empty: true,
  ...overrides,
});

const tool = (id: string, status: 'ok' | 'fail' = 'ok'): TranscriptEntry => ({
  kind: 'tool',
  id,
  tool: 'run_tests',
  target: 'apps/server',
  duration: '2s',
  status,
  resultLabel: null,
  output: null,
});

const human = (id: string): TranscriptEntry => ({
  kind: 'human',
  id,
  at: '2026-08-21T00:05:00Z',
  text: 'Do the boring thing.',
});

describe('visibleEntries', () => {
  const entries: TranscriptEntry[] = [
    divider(1, { empty: false }),
    tool('t1'),
    divider(2), // idle — nothing follows before the next divider
    divider(3, { empty: false }),
    human('h1'),
    tool('t2', 'fail'),
  ];

  it('keeps everything on "all"', () => {
    expect(visibleEntries(entries, 'all')).toEqual(entries);
  });

  it('drops dividers with no matching content instead of keeping the wall', () => {
    const tools = visibleEntries(entries, 'tools');
    expect(tools.map((e) => e.id)).toEqual(['p1', 't1', 'p3', 't2']);

    const errors = visibleEntries(entries, 'errors');
    // Pulse 1's tool passed, so its divider goes too.
    expect(errors.map((e) => e.id)).toEqual(['p3', 't2']);

    const mine = visibleEntries(entries, 'mine');
    expect(mine.map((e) => e.id)).toEqual(['p3', 'h1']);
  });
});

describe('groupIdlePulses', () => {
  it('collapses a run of 2+ idle ok pulses into one aggregate row', () => {
    const rows = groupIdlePulses([
      divider(1, { cost: 0.1 }),
      divider(2, { cost: 0.2 }),
      divider(3, { cost: 0.3 }),
      divider(4, { empty: false }),
      tool('t1'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['idle-group', 'pulse-divider', 'tool']);
    const group = rows[0];
    if (group.kind !== 'idle-group') throw new Error('expected idle-group');
    expect(group.count).toBe(3);
    expect(group.cost).toBeCloseTo(0.6, 10);
    expect(group.members.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(group.from).toBe(group.members[0].at);
    expect(group.to).toBe(group.members[2].at);
  });

  it('leaves a lone idle pulse as an ordinary divider', () => {
    const rows = groupIdlePulses([divider(1), tool('t1')]);
    expect(rows.map((r) => r.kind)).toEqual(['pulse-divider', 'tool']);
  });

  it('never collapses a warn or fail pulse — those are findings', () => {
    const rows = groupIdlePulses([
      divider(1),
      divider(2, { outcome: 'warn' }),
      divider(3),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['pulse-divider', 'pulse-divider', 'pulse-divider']);
  });

  it('collapses nothing on payloads from servers without the empty flag', () => {
    const legacy: TranscriptEntry[] = [
      { kind: 'pulse-divider', id: 'p1', seq: 1, at: '00:00', duration: '4s', cost: 0 },
      { kind: 'pulse-divider', id: 'p2', seq: 2, at: '00:30', duration: '4s', cost: 0 },
    ];
    expect(groupIdlePulses(legacy).map((r) => r.kind)).toEqual(['pulse-divider', 'pulse-divider']);
  });
});
