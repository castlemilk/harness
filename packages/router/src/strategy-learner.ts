import type { Complexity } from '@omega/core';
import type { RoutingStrategy, TaskDomain } from './intelligent.js';

interface StrategyScore {
  wins: number;
  total: number;
  avgScore: number;
}

export class StrategyLearner {
  /** key = "${domain}:${complexity}:${strategy}" */
  scores = new Map<string, StrategyScore>();

  recordOutcome(
    domain: TaskDomain,
    complexity: Complexity,
    strategy: RoutingStrategy,
    passed: boolean,
    costUsd: number,
  ): void {
    const key = `${domain}:${complexity}:${strategy}`;
    const existing = this.scores.get(key) ?? { wins: 0, total: 0, avgScore: 0 };
    existing.total++;
    if (passed) existing.wins++;
    const goodness = (passed ? 1 : 0) - Math.min(1, costUsd * 10);
    existing.avgScore = existing.avgScore * 0.9 + goodness * 0.1;
    this.scores.set(key, existing);
  }

  recommend(domain: TaskDomain, complexity: Complexity): RoutingStrategy | undefined {
    const strategies: RoutingStrategy[] = ['balanced', 'cost-optimized', 'performance-optimized'];
    let bestStrategy: RoutingStrategy | undefined;
    let bestScore = -Infinity;

    for (const strategy of strategies) {
      const key = `${domain}:${complexity}:${strategy}`;
      const score = this.scores.get(key);
      if (!score || score.total < 3) continue;
      const n = score.total;
      const z = 1.96;
      const phat = score.wins / n;
      const wilson = (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);
      const adjustedScore = wilson - Math.min(1, score.avgScore * -1) * 0.1;
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  getStats(): { domain: string; complexity: string; strategy: string; wins: number; total: number; passRate: number; avgScore: number }[] {
    return Array.from(this.scores.entries()).map(([key, s]) => {
      const [domain, complexity, strategy = 'unknown'] = key.split(':');
      return {
        domain,
        complexity,
        strategy,
        wins: s.wins,
        total: s.total,
        passRate: s.total > 0 ? s.wins / s.total : 0,
        avgScore: s.avgScore,
      };
    });
  }
}
