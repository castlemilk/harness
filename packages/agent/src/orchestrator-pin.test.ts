import { describe, expect, it } from 'vitest';
import { resolvePinnedModel } from './orchestrator-utils.js';

/**
 * An explicit provider+model on the parent task is an operator instruction.
 * Before this existed, the orchestrator routed every subtask through the
 * intelligent router regardless — a task pinned to openrouter/stealth-ox-alpha
 * ran its subtasks on kimi/moonshot-v1-32k, which silently invalidates both
 * "orchestrate model X" and any model comparison run through the orchestrator.
 */
describe('resolvePinnedModel', () => {
  it('honours a complete pin', () => {
    expect(resolvePinnedModel({ provider: 'openrouter', model: 'stealth/ox-alpha' })).toEqual({
      provider: 'openrouter',
      model: 'stealth/ox-alpha',
    });
  });

  it('ignores an incomplete pin rather than half-applying it', () => {
    expect(resolvePinnedModel({ provider: 'openrouter', model: null })).toBeUndefined();
    expect(resolvePinnedModel({ provider: null, model: 'stealth/ox-alpha' })).toBeUndefined();
    expect(resolvePinnedModel({})).toBeUndefined();
  });

  it('treats blank or whitespace-only fields as unpinned, and trims', () => {
    expect(resolvePinnedModel({ provider: '  ', model: 'm' })).toBeUndefined();
    expect(resolvePinnedModel({ provider: ' openrouter ', model: ' m ' })).toEqual({
      provider: 'openrouter',
      model: 'm',
    });
  });
});
