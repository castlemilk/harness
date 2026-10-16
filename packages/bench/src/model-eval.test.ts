import { describe, expect, it } from 'vitest';
import { attributeHarnessRun } from './model-eval.js';

describe('attributeHarnessRun', () => {
  it('splits a pinned model id into provider and model', () => {
    expect(attributeHarnessRun('opencode/deepseek-v4.1-flash-free', 'opencode')).toEqual({
      provider: 'opencode',
      model: 'deepseek-v4.1-flash-free',
    });
  });

  it('keeps an arm label on the model so conditions stay distinguishable', () => {
    expect(attributeHarnessRun('opencode/deepseek-v4.1-flash-free+skills', 'opencode')).toEqual({
      provider: 'opencode',
      model: 'deepseek-v4.1-flash-free+skills',
    });
  });

  it('splits on the first slash only, leaving scoped model names intact', () => {
    expect(attributeHarnessRun('openrouter/deepseek/deepseek-v4.1-flash', 'opencode')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4.1-flash',
    });
  });

  it('treats a bare CLI name as an external identity', () => {
    expect(attributeHarnessRun('agy', 'agy')).toEqual({ provider: 'external', model: 'agy' });
  });

  it('falls back to the CLI when nothing is pinned', () => {
    expect(attributeHarnessRun(undefined, 'opencode')).toEqual({ provider: 'external', model: 'opencode' });
    expect(attributeHarnessRun('   ', 'opencode')).toEqual({ provider: 'external', model: 'opencode' });
  });

  it('does not produce an empty provider or model from a malformed id', () => {
    expect(attributeHarnessRun('/deepseek-v4.1-flash-free', 'opencode')).toEqual({
      provider: 'external',
      model: '/deepseek-v4.1-flash-free',
    });
    expect(attributeHarnessRun('opencode/', 'opencode')).toEqual({
      provider: 'external',
      model: 'opencode/',
    });
  });
});
