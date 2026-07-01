import { describe, it, expect } from 'vitest';
import type { Capability } from './provider.js';
import type { Complexity } from './task.js';

function bestCapability(caps: Capability[], minLevel: Complexity): Capability | undefined {
  const levels: Record<Complexity, number> = { simple: 1, medium: 2, complex: 3 };
  const providerLevels: Record<Capability['level'], number> = { fast: 1, capable: 2, advanced: 3 };
  const min = levels[minLevel];
  return caps
    .filter((c) => providerLevels[c.level] >= min)
    .sort((a, b) => providerLevels[a.level] - providerLevels[b.level])[0];
}

describe('bestCapability', () => {
  it('picks advanced for complex tasks', () => {
    const caps: Capability[] = [{ name: 'gpt-4o', level: 'advanced' }];
    expect(bestCapability(caps, 'complex')?.name).toBe('gpt-4o');
  });

  it('falls back to capable when no advanced is available', () => {
    const caps: Capability[] = [
      { name: 'fast', level: 'fast' },
      { name: 'capable', level: 'capable' },
    ];
    expect(bestCapability(caps, 'medium')?.name).toBe('capable');
  });

  it('returns undefined when no capability meets the level', () => {
    const caps: Capability[] = [{ name: 'fast', level: 'fast' }];
    expect(bestCapability(caps, 'complex')).toBeUndefined();
  });
});
