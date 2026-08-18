import { describe, expect, it } from 'vitest';
import { projectObjectiveState } from './adapt.js';
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
