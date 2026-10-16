import { describe, expect, it } from 'vitest';
import { ProviderHealthRegistry } from './health-registry.js';

/** Record `count` samples that are all failures. */
function recordFailures(
  registry: ProviderHealthRegistry,
  providerKey: string,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    registry.record(providerKey, { latencyMs: 10, success: false, rateLimited: false, costUsd: 0 });
  }
}

describe('ProviderHealthRegistry.reset', () => {
  it('closes a circuit the samples had opened', () => {
    const registry = new ProviderHealthRegistry();
    recordFailures(registry, 'external:opencode', 5);
    expect(registry.isCircuitBroken('external:opencode')).toBe(true);

    expect(registry.reset('external:opencode')).toBe(true);

    expect(registry.isCircuitBroken('external:opencode')).toBe(false);
    expect(registry.getCircuitState('external:opencode')).toBe('closed');
  });

  it('clears the samples so one new failure cannot re-open the circuit', () => {
    const registry = new ProviderHealthRegistry();
    recordFailures(registry, 'external:opencode', 5);
    registry.reset('external:opencode');

    // The gateway abort that prompted the reset: a single failure carries no
    // error rate, so the circuit must stay closed.
    registry.record('external:opencode', { latencyMs: 10, success: false, rateLimited: false, costUsd: 0 });
    expect(registry.isCircuitBroken('external:opencode')).toBe(false);
    expect(registry.getHealth('external:opencode').recentCalls).toBe(1);
  });

  it('drops the provider from the health entries', () => {
    const registry = new ProviderHealthRegistry();
    recordFailures(registry, 'external:opencode', 5);
    expect(registry.getEntries().some((entry) => entry.provider === 'external:opencode')).toBe(true);

    registry.reset('external:opencode');

    expect(registry.getEntries().some((entry) => entry.provider === 'external:opencode')).toBe(false);
    expect(registry.getHealth('external:opencode')).toMatchObject({ recentCalls: 0, errorRate: 0, score: 5 });
  });

  it('reports false for a provider it has never seen', () => {
    const registry = new ProviderHealthRegistry();
    expect(registry.reset('external:never-run')).toBe(false);
  });

  it('leaves other providers alone', () => {
    const registry = new ProviderHealthRegistry();
    recordFailures(registry, 'external:opencode', 5);
    recordFailures(registry, 'external:agy', 5);

    registry.reset('external:opencode');

    expect(registry.getCircuitState('external:opencode')).toBe('closed');
    expect(registry.getCircuitState('external:agy')).toBe('open');
  });
});
