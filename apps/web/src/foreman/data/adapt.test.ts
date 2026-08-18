import { describe, expect, it } from 'vitest';
import {
  applyHarnessPatch,
  applyIntervention,
  applyPulse,
  projectHarnessPatch,
  projectIntervention,
  projectObjectiveState,
  projectPulse,
} from './adapt.js';
import { OBJECTIVE_STATE_FIXTURE } from './fixtures/objective-state.js';

/**
 * The boundary check: the one place server state enters the app.
 *
 * The positive case runs against a captured real payload — a checker that only
 * ever sees hand-written input agrees with itself. The negative cases are the
 * three failures that used to reach a component as a crash or a plausible
 * `NaN` instead of an error naming the field.
 */

function state(overrides: Record<string, unknown> = {}): unknown {
  const base = OBJECTIVE_STATE_FIXTURE as Record<string, unknown>;
  return { ...base, ...overrides };
}

function withHarness(patch: Record<string, unknown>): unknown {
  const base = OBJECTIVE_STATE_FIXTURE as { harnesses: Record<string, unknown>[] };
  const [first, ...rest] = base.harnesses;
  return state({ harnesses: [{ ...first, ...patch }, ...rest] });
}

describe('projectObjectiveState', () => {
  it('accepts the real server payload and hands it straight through', () => {
    const projected = projectObjectiveState(OBJECTIVE_STATE_FIXTURE);
    expect(projected.harnesses).toHaveLength(2);
    expect(projected.workstreams).toHaveLength(2);
    expect(projected.objective.id).toBe('e2e00000-0000-4000-8000-000000000010');
    expect(projected.objective.name).toBe('Ship the Foreman control plane');
    expect(projected.harnesses[0].recentPulses).toHaveLength(2);
  });

  it('rejects harnesses that are not an array', () => {
    // `.map` on this is the crash; naming the field is the whole point.
    expect(() => projectObjectiveState(state({ harnesses: null }))).toThrow(
      'Foreman state is malformed: harnesses must be an array',
    );
    expect(() => projectObjectiveState(state({ tickets: { 0: 'x' } }))).toThrow(
      'Foreman state is malformed: tickets must be an array',
    );
  });

  it('rejects a non-string id', () => {
    expect(() => projectObjectiveState(withHarness({ id: 42 }))).toThrow(
      'Foreman state is malformed: harnesses[0].id must be a non-empty string',
    );
    expect(() =>
      projectObjectiveState(state({ objective: { ...(OBJECTIVE_STATE_FIXTURE as { objective: object }).objective, id: null } })),
    ).toThrow('Foreman state is malformed: objective.id must be a non-empty string');
  });

  it('rejects a spend that is not a finite number', () => {
    // NaN spend renders as an empty meter — indistinguishable from $0 spent.
    expect(() => projectObjectiveState(withHarness({ spend: Number.NaN }))).toThrow(
      'Foreman state is malformed: harnesses[0].spend must be a finite number, got NaN',
    );
    expect(() =>
      projectObjectiveState(
        state({
          objective: {
            ...(OBJECTIVE_STATE_FIXTURE as { objective: object }).objective,
            spendToday: null,
          },
        }),
      ),
    ).toThrow('Foreman state is malformed: objective.spendToday must be a finite number, got null');
  });

  it('rejects a payload that is not an object at all', () => {
    // An HTML error page from a proxy arrives exactly like this.
    expect(() => projectObjectiveState('<!doctype html>')).toThrow(
      'Foreman state is malformed: state must be an object',
    );
  });
});

/**
 * The SSE patches. Three more doors into the same state, and until UC-4's
 * review they were three casts: `JSON.parse(...) as Harness`. A harness patch
 * for a harness this client had never seen (another operator spawned one while
 * this one watched) got appended whole, so a payload without `recentPulses`
 * put `undefined` where every shell calls `.map`.
 */
const base = () => projectObjectiveState(OBJECTIVE_STATE_FIXTURE);

const NEW_HARNESS = {
  id: 'spawned-elsewhere',
  name: 'spawned-elsewhere',
  status: 'working',
  spend: 0,
  subtreeSpend: 0,
  parentId: null,
  workstreamId: null,
  childCount: 0,
  latestPulseSeq: null,
};

describe('projectHarnessPatch', () => {
  it('defaults the list fields a shell walks, rather than passing undefined on', () => {
    // The server sends recentPulses; routine it cannot (it needs a playbook
    // join the stream does not do). Both are `.map`ped on render.
    const patch = projectHarnessPatch({ ...NEW_HARNESS });
    expect(patch.recentPulses).toEqual([]);
    expect(patch.routine).toEqual([]);
  });

  it('keeps the pulses the server did send', () => {
    const pulse = { id: 'p1', seq: 4, startedAt: '2026-08-17T23:34:04.845Z', outcome: 'ok' };
    const patch = projectHarnessPatch({ ...NEW_HARNESS, recentPulses: [pulse] });
    expect(patch.recentPulses).toHaveLength(1);
    expect(patch.recentPulses[0].seq).toBe(4);
  });

  it('rejects garbage instead of appending it to the fleet', () => {
    expect(() => projectHarnessPatch('<!doctype html>')).toThrow(
      'Foreman state is malformed: harness patch must be an object',
    );
    expect(() => projectHarnessPatch({ ...NEW_HARNESS, id: '' })).toThrow(
      'Foreman state is malformed: harness patch id must be a non-empty string',
    );
    expect(() => projectHarnessPatch({ ...NEW_HARNESS, spend: Number.NaN })).toThrow(
      'Foreman state is malformed: harness patch spawned-elsewhere.spend must be a finite number, got NaN',
    );
    expect(() => projectHarnessPatch({ ...NEW_HARNESS, recentPulses: 'none' })).toThrow(
      'Foreman state is malformed: harness patch spawned-elsewhere.recentPulses must be an array',
    );
  });
});

describe('projectPulse', () => {
  it('accepts a real pulse frame and names both halves', () => {
    const frame = projectPulse({
      harnessId: 'h1',
      pulse: { id: 'p1', seq: 19, startedAt: '2026-08-17T23:34:04.845Z', outcome: 'ok' },
    });
    expect(frame.harnessId).toBe('h1');
    expect(frame.pulse.seq).toBe(19);
  });

  it('rejects a frame missing the fields the updater indexes into', () => {
    expect(() => projectPulse({ pulse: { id: 'p1', seq: 1 } })).toThrow(
      'Foreman state is malformed: pulse frame harnessId must be a non-empty string',
    );
    expect(() => projectPulse({ harnessId: 'h1' })).toThrow(
      'Foreman state is malformed: pulse frame pulse must be an object',
    );
    expect(() => projectPulse({ harnessId: 'h1', pulse: { id: 'p1', seq: null } })).toThrow(
      'Foreman state is malformed: pulse frame pulse.seq must be a finite number, got null',
    );
  });
});

describe('projectIntervention', () => {
  it('accepts the real intervention shape', () => {
    const wire = (OBJECTIVE_STATE_FIXTURE as { interventions: unknown[] }).interventions[0];
    expect(projectIntervention(wire).id).toBe('e2e00000-0000-4000-8000-000000000601');
  });

  it('rejects one with no id, which would duplicate on every frame', () => {
    expect(() => projectIntervention({ harnessId: 'h1' })).toThrow(
      'Foreman state is malformed: intervention patch id must be a non-empty string',
    );
  });
});

describe('applyHarnessPatch', () => {
  it('appends a harness spawned by another client with a usable pulse list', () => {
    // The regression: this path used to produce `recentPulses: undefined`, and
    // both the next render and the next pulse frame threw on it.
    const next = applyHarnessPatch(base(), projectHarnessPatch({ ...NEW_HARNESS }));
    expect(next.harnesses).toHaveLength(3);
    const added = next.harnesses[2];
    expect(added.id).toBe('spawned-elsewhere');
    expect(added.recentPulses).toEqual([]);
    expect(added.routine).toEqual([]);

    // And the very next pulse for it folds in rather than throwing.
    const pulsed = applyPulse(next, projectPulse({
      harnessId: 'spawned-elsewhere',
      pulse: { id: 'p1', seq: 1, startedAt: '2026-08-17T23:40:00.000Z', outcome: 'ok' },
    }));
    expect(pulsed.harnesses[2].recentPulses.map((p) => p.id)).toEqual(['p1']);
    expect(pulsed.harnesses[2].latestPulseSeq).toBe(1);
  });

  it('merges onto a known harness without erasing its pulse history', () => {
    // The stream's pulse window is narrower than the snapshot's, so an empty
    // list on a patch means "nothing recent", not "nothing ever".
    const before = base();
    const known = before.harnesses[0];
    expect(known.recentPulses.length).toBeGreaterThan(0);

    const next = applyHarnessPatch(
      before,
      projectHarnessPatch({ ...known, activity: 'Patched over the stream', recentPulses: [] }),
    );
    expect(next.harnesses).toHaveLength(2);
    expect(next.harnesses[0].activity).toBe('Patched over the stream');
    expect(next.harnesses[0].recentPulses).toEqual(known.recentPulses);
    expect(next.harnesses[0].routine).toEqual(known.routine);
  });
});

describe('applyPulse', () => {
  it('puts the new pulse at the head, replaces a resend, and caps the list', () => {
    const before = base();
    const id = before.harnesses[0].id;
    const pulse = (seq: number, pid: string) => projectPulse({
      harnessId: id,
      pulse: { id: pid, seq, startedAt: '2026-08-17T23:40:00.000Z', outcome: 'ok' },
    });

    const once = applyPulse(before, pulse(19, 'p-new'));
    expect(once.harnesses[0].recentPulses[0].id).toBe('p-new');
    expect(once.harnesses[0].latestPulseSeq).toBe(19);

    const twice = applyPulse(once, pulse(19, 'p-new'));
    expect(twice.harnesses[0].recentPulses.filter((p) => p.id === 'p-new')).toHaveLength(1);

    let many = before;
    for (let i = 0; i < 20; i += 1) many = applyPulse(many, pulse(100 + i, `p-${String(i)}`));
    expect(many.harnesses[0].recentPulses).toHaveLength(12);
    expect(many.harnesses[0].recentPulses[0].id).toBe('p-19');
  });
});

describe('applyIntervention', () => {
  const item = (id: string, status: string) => projectIntervention({
    ...(OBJECTIVE_STATE_FIXTURE as { interventions: Record<string, unknown>[] }).interventions[0],
    id,
    status,
  });

  it('adds a pending intervention once, however many frames repeat it', () => {
    const once = applyIntervention(base(), item('needs-you', 'pending'));
    const twice = applyIntervention(once, item('needs-you', 'pending'));
    expect(twice.interventions.filter((i) => i.id === 'needs-you')).toHaveLength(1);
  });

  it('drops one that has been resolved', () => {
    const before = base();
    const existing = before.interventions[0].id;
    const next = applyIntervention(before, item(existing, 'answered'));
    expect(next.interventions.map((i) => i.id)).not.toContain(existing);
  });
});
