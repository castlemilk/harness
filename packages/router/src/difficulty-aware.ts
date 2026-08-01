import type { ProviderConfig, Task } from '@omega/core';
import { type RoutingRule } from './rules.js';

export interface HistoricalScore {
  provider: string;
  model: string;
  runs: number;
  passes: number;
  passRate: number;
  avgDurationMs: number;
  avgCostUsd: number;
}

export interface DifficultyAwareOptions {
  /** Minimum pass rate to consider a provider "reliable" for this complexity */
  minPassRate?: number;
  /** Weight given to historical pass rate vs capability match (0-1) */
  historyWeight?: number;
}

function costPerPass(passRate: number, avgCostUsd: number): number {
  if (passRate === 0) return Infinity;
  return avgCostUsd / passRate;
}

export async function getHistoricalScores(
  queryFn: () => Promise<{
    resultStatus: string;
    costUsd: number | null;
    createdAt: Date;
    updatedAt: Date;
    provider: string | null;
    model: string | null;
  }[]>,
): Promise<Map<string, HistoricalScore>> {
  const runs = await queryFn();

  const scoreMap = new Map<string, { passes: number; total: number; totalCost: number; totalDuration: number }>();

  for (const run of runs) {
    const provider = run.provider;
    const model = run.model;
    if (!provider || !model) continue;
    const key = `${provider}/${model}`;
    const existing = scoreMap.get(key) ?? { passes: 0, total: 0, totalCost: 0, totalDuration: 0 };
    existing.total++;
    if (run.resultStatus === 'done') existing.passes++;
    existing.totalCost += run.costUsd ?? 0;
    existing.totalDuration += run.updatedAt.getTime() - run.createdAt.getTime();
    scoreMap.set(key, existing);
  }

  const result = new Map<string, HistoricalScore>();
  for (const [key, data] of scoreMap) {
    const [provider, model] = key.split('/');
    result.set(key, {
      provider: provider,
      model: model,
      runs: data.total,
      passes: data.passes,
      passRate: data.total > 0 ? data.passes / data.total : 0,
      avgDurationMs: data.total > 0 ? Math.round(data.totalDuration / data.total) : 0,
      avgCostUsd: data.total > 0 ? data.totalCost / data.total : 0,
    });
  }

  return result;
}

export function selectProviderWithHistory(
  configs: ProviderConfig[],
  rules: RoutingRule[],
  task: Task,
  historicalScores: Map<string, HistoricalScore>,
  options: DifficultyAwareOptions = {},
): { provider: ProviderConfig; model: string } | undefined {
  const minPassRate = options.minPassRate ?? 0.5;
  const historyWeight = options.historyWeight ?? 0.3;

  const enabled = configs.filter((cfg) => cfg.enabled);
  let bestCandidate: { provider: ProviderConfig; model: string; score: number } | undefined;

  for (const provider of enabled) {
    const key = `${provider.name}/${provider.defaultModel}`;
    const historical = historicalScores.get(key);

    let capabilityScore = 0;
    const capLevels: Record<string, number> = { fast: 1, capable: 2, advanced: 3 };
    for (const cap of provider.capabilities) {
      const capScore = capLevels[cap.level] ?? 1;
      if (capScore > capabilityScore) capabilityScore = capScore;
    }

    const complexityRank: Record<string, number> = { simple: 1, medium: 2, complex: 3 };
    const taskRank = complexityRank[task.complexity] ?? 2;
    if (capabilityScore < taskRank) {
      capabilityScore -= 10;
    }

    let score: number;
    if (historical && historical.runs >= 3) {
      const histScore = historical.passRate * 10 - costPerPass(historical.passRate, historical.avgCostUsd) * 2;
      score = (1 - historyWeight) * capabilityScore + historyWeight * histScore;

      if (historical.passRate < minPassRate && task.complexity !== 'simple') {
        score -= 20;
      }
    } else {
      score = capabilityScore;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { provider, model: provider.defaultModel, score };
    }
  }

  return bestCandidate ? { provider: bestCandidate.provider, model: bestCandidate.model } : undefined;
}
