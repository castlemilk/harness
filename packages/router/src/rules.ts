import type { Capability, Complexity, ProviderConfig, Task } from '@omega/core';

export interface RoutingRule {
  priority: number;
  when: {
    complexity?: Complexity;
    tags?: string[];
  };
  then: {
    provider?: string;
    model?: string;
  };
}

const levelRank: Record<Complexity, number> = {
  simple: 1,
  medium: 2,
  complex: 3,
};

const capRank: Record<Capability['level'], number> = {
  fast: 1,
  capable: 2,
  advanced: 3,
};

export function rankCapabilityForTask(cap: Capability, task: Task): number {
  let score = capRank[cap.level];

  if (capRank[cap.level] < levelRank[task.complexity]) {
    score -= 10;
  }

  if (task.tags.includes('vision') && !cap.supportsVision) {
    score -= 10;
  }

  if (task.tags.includes('tools') && !cap.supportsTools) {
    score -= 10;
  }

  return score;
}

export function selectProvider(
  configs: ProviderConfig[],
  rules: RoutingRule[],
  task: Task
): { provider: ProviderConfig; model: string } | undefined {
  const enabled = configs.filter((cfg) => cfg.enabled);
  if (enabled.length === 0) {
    return undefined;
  }

  const matchingRules = rules
    .filter((rule) => {
      if (rule.when.complexity && rule.when.complexity !== task.complexity) {
        return false;
      }
      if (rule.when.tags && !rule.when.tags.every((tag) => task.tags.includes(tag))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.priority - a.priority);

  for (const rule of matchingRules) {
    const provider = rule.then.provider
      ? enabled.find((cfg) => cfg.id === rule.then.provider || cfg.name === rule.then.provider)
      : enabled[0];

    if (provider) {
      return { provider, model: rule.then.model || provider.defaultModel };
    }
  }

  let best: { provider: ProviderConfig; model: string; score: number } | undefined;

  for (const provider of enabled) {
    for (const cap of provider.capabilities) {
      const score = rankCapabilityForTask(cap, task);
      if (!best || score > best.score) {
        best = { provider, model: provider.defaultModel, score };
      }
    }
  }

  return best ? { provider: best.provider, model: best.model } : undefined;
}
