import { describe, expect, it } from 'vitest';
import type { ProviderConfig, Task } from '@omega/core';
import type { RoutingRule} from './rules.js';
import { rankCapabilityForTask, selectProvider } from './rules.js';
import { pickModelFromConfigs } from './tiers.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Test task',
    status: 'todo',
    complexity: 'simple',
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    kind: 'generic',
    defaultModel: 'default-model',
    capabilities: [{ name: 'default', level: 'fast' }],
    enabled: true,
    ...overrides,
  };
}

describe('rankCapabilityForTask', () => {
  it('assigns a higher score to a capability that matches task complexity', () => {
    const task = makeTask({ complexity: 'complex' });
    const fastCap = { name: 'fast', level: 'fast' as const };
    const advancedCap = { name: 'advanced', level: 'advanced' as const };

    expect(rankCapabilityForTask(advancedCap, task)).toBeGreaterThan(
      rankCapabilityForTask(fastCap, task)
    );
  });

  it('downgrades vision mismatches', () => {
    const task = makeTask({ tags: ['vision'] });
    const withoutVision = { name: 'capable', level: 'capable' as const, supportsVision: false };
    const withVision = { name: 'capable', level: 'capable' as const, supportsVision: true };

    expect(rankCapabilityForTask(withVision, task)).toBeGreaterThan(
      rankCapabilityForTask(withoutVision, task)
    );
  });

  it('downgrades tools mismatches', () => {
    const task = makeTask({ tags: ['tools'] });
    const withoutTools = { name: 'capable', level: 'capable' as const, supportsTools: false };
    const withTools = { name: 'capable', level: 'capable' as const, supportsTools: true };

    expect(rankCapabilityForTask(withTools, task)).toBeGreaterThan(
      rankCapabilityForTask(withoutTools, task)
    );
  });
});

describe('selectProvider', () => {
  it('routes complex tasks to an advanced model', () => {
    const configs = [
      makeProvider({ id: 'fast', capabilities: [{ name: 'fast', level: 'fast' }] }),
      makeProvider({ id: 'advanced', capabilities: [{ name: 'advanced', level: 'advanced' }] }),
    ];
    const task = makeTask({ complexity: 'complex' });

    const result = selectProvider(configs, [], task);

    expect(result?.provider.id).toBe('advanced');
  });

  it('lets an explicit rule override the capability score', () => {
    const configs = [
      makeProvider({ id: 'fast', capabilities: [{ name: 'fast', level: 'fast' }] }),
      makeProvider({ id: 'advanced', capabilities: [{ name: 'advanced', level: 'advanced' }] }),
    ];
    const rules: RoutingRule[] = [
      {
        priority: 10,
        when: { complexity: 'complex' },
        then: { provider: 'fast', model: 'override-model' },
      },
    ];
    const task = makeTask({ complexity: 'complex' });

    const result = selectProvider(configs, rules, task);

    expect(result?.provider.id).toBe('fast');
    expect(result?.model).toBe('override-model');
  });

  it('downgrades providers that do not satisfy tag-based requirements', () => {
    const configs = [
      makeProvider({
        id: 'vision',
        capabilities: [{ name: 'vision', level: 'capable', supportsVision: true, supportsTools: false }],
      }),
      makeProvider({
        id: 'tools',
        capabilities: [{ name: 'tools', level: 'capable', supportsVision: false, supportsTools: true }],
      }),
    ];
    const task = makeTask({ complexity: 'medium', tags: ['tools'] });

    const result = selectProvider(configs, [], task);

    expect(result?.provider.id).toBe('tools');
  });

  it('does not select disabled providers', () => {
    const configs = [makeProvider({ id: 'disabled', enabled: false })];
    const task = makeTask();

    const result = selectProvider(configs, [], task);

    expect(result).toBeUndefined();
  });

  it('returns undefined when no provider matches', () => {
    const configs: ProviderConfig[] = [];
    const task = makeTask();

    const result = selectProvider(configs, [], task);

    expect(result).toBeUndefined();
  });
});

describe('pickModelFromConfigs', () => {
  const configs = [
    makeProvider({
      name: 'tiered',
      defaultModel: 'moonshot-v1-8k',
      capabilities: [
        { name: 'moonshot-v1-128k', level: 'advanced' },
        { name: 'moonshot-v1-32k', level: 'advanced' },
        { name: 'moonshot-v1-8k', level: 'capable' },
      ],
    }),
  ];

  it('keeps high, medium, and low orchestration tiers distinct', () => {
    expect(pickModelFromConfigs(configs, 'high')).toEqual({
      provider: 'tiered',
      model: 'moonshot-v1-128k',
    });
    expect(pickModelFromConfigs(configs, 'medium')).toEqual({
      provider: 'tiered',
      model: 'moonshot-v1-32k',
    });
    expect(pickModelFromConfigs(configs, 'low')).toEqual({
      provider: 'tiered',
      model: 'moonshot-v1-8k',
    });
  });
});

describe('PerformanceCache.loadAggregate', () => {
  it('folds an aggregated benchmark run into the same key space the scorer reads', async () => {
    const { PerformanceCache } = await import('./performance-cache.js');
    const cache = new PerformanceCache();
    cache.loadAggregate('kimi/moonshot-v1-8k', {
      passes: 8,
      total: 10,
      costUsd: 0.4,
      durationMs: 60_000,
      at: new Date(),
    });
    cache.loadAggregate('kimi/moonshot-v1-8k', {
      passes: 6,
      total: 10,
      costUsd: 0.2,
      durationMs: 55_000,
      at: new Date(),
    });
    const score = cache.getScore('kimi/moonshot-v1-8k');
    expect(score).toBeDefined();
    expect(score?.totalRuns).toBe(20);
    expect(score?.passRate).toBeCloseTo(0.7, 10);
    expect(score?.avgCostUsd).toBeCloseTo(0.03, 10);
  });

  it('clamps passes to total and ignores empty runs', async () => {
    const { PerformanceCache } = await import('./performance-cache.js');
    const cache = new PerformanceCache();
    cache.loadAggregate('x/y', { passes: 99, total: 5, costUsd: 0, durationMs: 0, at: new Date() });
    cache.loadAggregate('x/y', { passes: 1, total: 0, costUsd: 0, durationMs: 0, at: new Date() });
    const score = cache.getScore('x/y');
    expect(score?.totalRuns).toBe(5);
    expect(score?.passRate).toBe(1);
  });

  it('keeps recency honest — an old benchmark arrives decayed, not fresh', async () => {
    const { PerformanceCache } = await import('./performance-cache.js');
    const cache = new PerformanceCache();
    const sixWeeksAgo = new Date(Date.now() - 42 * 24 * 60 * 60 * 1_000);
    cache.loadAggregate('old/model', { passes: 5, total: 5, costUsd: 0.1, durationMs: 1000, at: sixWeeksAgo });
    const score = cache.getScore('old/model');
    // 7-day half-life over 6 weeks: recency well under 5%.
    expect(score?.recencyFactor ?? 1).toBeLessThan(0.05);
  });
});
