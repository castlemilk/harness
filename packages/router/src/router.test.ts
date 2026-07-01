import { describe, expect, it } from 'vitest';
import type { ProviderConfig, Task } from '@omega/core';
import { rankCapabilityForTask, RoutingRule, selectProvider } from './rules.js';

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
