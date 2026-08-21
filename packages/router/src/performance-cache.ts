// ─── Performance Cache ──────────────────────────────────────────────────────

interface PerfEntry {
  passes: number;
  total: number;
  totalCost: number;
  totalDuration: number;
  lastUpdated: number;
}

export class PerformanceCache {
  private cache = new Map<string, PerfEntry>();
  private decayHalfLife = 7 * 24 * 60 * 60 * 1000; // 7 days

  update(key: string, passed: boolean, costUsd: number, durationMs: number): void {
    const entry = this.cache.get(key) ?? { passes: 0, total: 0, totalCost: 0, totalDuration: 0, lastUpdated: Date.now() };
    entry.total++;
    if (passed) entry.passes++;
    entry.totalCost += costUsd;
    entry.totalDuration += durationMs;
    entry.lastUpdated = Date.now();
    this.cache.set(key, entry);
  }

  loadFromRows(rows: {
    provider: string | null;
    model: string | null;
    resultStatus: string;
    costUsd: number | null;
    createdAt: Date;
    updatedAt: Date;
  }[]): void {
    for (const row of rows) {
      if (!row.provider || !row.model) continue;
      const key = `${row.provider}/${row.model}`;
      const entry = this.cache.get(key) ?? { passes: 0, total: 0, totalCost: 0, totalDuration: 0, lastUpdated: Date.now() };
      entry.total++;
      if (row.resultStatus === 'done') entry.passes++;
      entry.totalCost += row.costUsd ?? 0;
      entry.totalDuration += row.updatedAt.getTime() - row.createdAt.getTime();
      entry.lastUpdated = row.updatedAt.getTime();
      this.cache.set(key, entry);
    }
  }

  /**
   * Fold an AGGREGATED result set (e.g. one benchmark run: N tasks, k passed)
   * into the cache. `loadFromRows` is one-row-per-task; benchmark history is
   * one-row-per-run, and expanding it back to synthetic task rows would just
   * be this method with extra allocation. `at` keeps the recency decay honest
   * — a six-week-old benchmark must not arrive looking fresh.
   */
  loadAggregate(
    key: string,
    agg: { passes: number; total: number; costUsd: number; durationMs: number; at: Date },
  ): void {
    if (agg.total <= 0) return;
    const entry = this.cache.get(key) ?? { passes: 0, total: 0, totalCost: 0, totalDuration: 0, lastUpdated: 0 };
    entry.total += agg.total;
    entry.passes += Math.min(agg.passes, agg.total);
    entry.totalCost += agg.costUsd;
    entry.totalDuration += agg.durationMs;
    entry.lastUpdated = Math.max(entry.lastUpdated, agg.at.getTime());
    this.cache.set(key, entry);
  }

  getScore(key: string): PerfScore | undefined {
    const entry = this.cache.get(key);
    if (!entry || entry.total === 0) return undefined;

    const passRate = entry.passes / entry.total;
    const avgCost = entry.totalCost / entry.total;
    const avgDuration = entry.totalDuration / entry.total;

    const n = entry.total;
    const z = 1.96;
    const phat = passRate;
    const wilson = (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);

    const costPerPass = passRate > 0 ? avgCost / passRate : Infinity;

    const age = Date.now() - entry.lastUpdated;
    const recencyFactor = Math.pow(0.5, age / this.decayHalfLife);

    return {
      passRate,
      wilsonLowerBound: Math.max(0, wilson),
      avgCostUsd: avgCost,
      avgDurationMs: avgDuration,
      totalRuns: entry.total,
      costPerPass,
      recencyFactor,
    };
  }

  getAllScores(): Map<string, PerfScore> {
    const result = new Map<string, PerfScore>();
    for (const key of this.cache.keys()) {
      const score = this.getScore(key);
      if (score) result.set(key, score);
    }
    return result;
  }
}

export interface PerfScore {
  passRate: number;
  wilsonLowerBound: number;
  avgCostUsd: number;
  avgDurationMs: number;
  totalRuns: number;
  costPerPass: number;
  recencyFactor: number;
}
