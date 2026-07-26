/**
 * Intelligent LLM Router — selects the best provider/model for each task
 * based on historical performance, cost efficiency, provider health, and
 * task characteristics.
 *
 * Architecture:
 *   1. ProviderHealthRegistry — real-time latency/error/rate-limit tracking
 *   2. PerformanceCache — decay-weighted historical pass rates + costs
 *   3. TaskClassifier — categorizes tasks for routing decisions
 *   4. ScoringEngine — combines all signals into a single score
 *   5. FallbackCascade — ordered list of alternatives with score breakdowns
 */

import type { ProviderConfig, Task, Capability, Complexity, CapabilityLevel } from '@omega/core';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RoutingStrategy = 'balanced' | 'cost-optimized' | 'performance-optimized' | 'consensus' | 'exploratory';

export interface RouteDecision {
  primary: RouteCandidate;
  fallbacks: RouteCandidate[];
  taskClassification: TaskClassification;
  strategy: RoutingStrategy;
  reasoning: string;
}

export interface RouteCandidate {
  provider: ProviderConfig;
  model: string;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  capability: number;    // 0-10: how well the model's capabilities match the task
  performance: number;   // 0-10: historical pass rate (Wilson lower bound)
  cost: number;          // 0-10: cost efficiency (inverse of cost-per-pass-rate)
  health: number;        // 0-10: provider health (latency, errors, rate limits)
  budget: number;        // 0-10: budget fit (0 if over budget, 10 if well under)
  recency: number;       // 0-10: how recently this provider was used (avoid overuse)
  total: number;         // weighted sum
}

export interface TaskClassification {
  complexity: Complexity;
  domain: TaskDomain;
  requiredCapabilities: string[];
  estimatedTokens: number;
}

export type TaskDomain = 'code' | 'data' | 'reasoning' | 'creative' | 'general';

export interface IntelligentRouterOptions {
  strategy?: RoutingStrategy;
  budgetUsd?: number;          // max cost per task
  maxCandidates?: number;      // how many fallbacks to return
  minHistoricalRuns?: number;  // minimum runs before trusting history
  explorationRate?: number;    // probability of trying an unknown provider (0-1)
}

// ─── Provider Health Registry ───────────────────────────────────────────────

interface HealthSample {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  rateLimited: boolean;
  costUsd: number;
}

const HEALTH_WINDOW_MS = 30 * 60 * 1000; // 30-minute rolling window
const HEALTH_DECAY = 0.95;                // exponential decay per sample

export class ProviderHealthRegistry {
  private samples = new Map<string, HealthSample[]>();
  private circuits = new Map<string, { state: 'closed' | 'open' | 'half-open'; openedAt: number; cooldownUntil: number; trialInFlight: boolean }>();
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  private static readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 min before half-open probe
  private static readonly DEFAULT_RATE_LIMIT = 60; // 60 requests per minute per provider
  private static readonly RATE_WINDOW_MS = 60_000; // 1-minute sliding window

  record(providerKey: string, sample: Omit<HealthSample, 'timestamp'>): void {
    const list = this.samples.get(providerKey) ?? [];
    list.push({ ...sample, timestamp: Date.now() });
    // Prune old samples
    const cutoff = Date.now() - HEALTH_WINDOW_MS;
    while (list.length > 0 && list[0]!.timestamp < cutoff) list.shift();
    this.samples.set(providerKey, list);

    // Update circuit breaker state on failures
    if (!sample.success && !sample.rateLimited) {
      const health = this.getHealth(providerKey);
      if (health.errorRate > 0.5 && health.recentCalls >= 5) {
        const circuit = this.circuits.get(providerKey);
        if (!circuit || circuit.state !== 'open') {
          this.circuits.set(providerKey, {
            state: 'open',
            openedAt: Date.now(),
            cooldownUntil: Date.now() + ProviderHealthRegistry.COOLDOWN_MS,
            trialInFlight: false,
          });
        }
      }
    } else if (sample.success) {
      // Recovery: close the circuit on success
      this.circuits.set(providerKey, {
        state: 'closed',
        openedAt: 0,
        cooldownUntil: 0,
        trialInFlight: false,
      });
    }
  }

  getHealth(providerKey: string): ProviderHealth {
    const list = this.samples.get(providerKey) ?? [];
    if (list.length === 0) {
      return { latencyP50: 0, latencyP95: 0, errorRate: 0, rateLimitRate: 0, recentCalls: 0, score: 5 };
    }

    const latencies = list.map((s) => s.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const errors = list.filter((s) => !s.success).length;
    const rateLimits = list.filter((s) => s.rateLimited).length;
    const errorRate = errors / list.length;
    const rateLimitRate = rateLimits / list.length;

    // Score: 10 = perfect health, 0 = completely unhealthy
    let score = 10;
    // Penalize high error rates (up to -5)
    score -= errorRate * 5;
    // Penalize rate limiting (up to -3)
    score -= rateLimitRate * 3;
    // Penalize high latency (up to -2)
    if (p95 > 30_000) score -= 2;
    else if (p95 > 15_000) score -= 1;
    else if (p95 > 5_000) score -= 0.5;

    return {
      latencyP50: p50,
      latencyP95: p95,
      errorRate,
      rateLimitRate,
      recentCalls: list.length,
      score: Math.max(0, Math.min(10, score)),
    };
  }

  /** Check if a provider is currently circuit-broken (high recent error rate). */
  isCircuitBroken(providerKey: string): boolean {
    const circuit = this.circuits.get(providerKey);
    if (!circuit || circuit.state === 'closed') {
      return false;
    }
    // Open: fully blocked
    if (circuit.state === 'open') {
      // Check if cooldown has elapsed — transition to half-open
      if (Date.now() >= circuit.cooldownUntil) {
        circuit.state = 'half-open';
        circuit.trialInFlight = false;
        return false; // allow a trial request
      }
      return true;
    }
    // Half-open: allow exactly one trial request
    if (circuit.state === 'half-open') {
      if (circuit.trialInFlight) {
        return true; // trial already in progress, block
      }
      circuit.trialInFlight = true;
      return false; // allow this one
    }
    return false;
  }

  /** Get circuit state for diagnostics */
  getCircuitState(providerKey: string): 'closed' | 'open' | 'half-open' {
    return this.circuits.get(providerKey)?.state ?? 'closed';
  }

  /**
   * Simple token-bucket rate limiter. Refills tokens proportionally to
   * elapsed time. Returns true if the request can proceed immediately.
   */
  checkRateLimit(providerKey: string, maxRpm = ProviderHealthRegistry.DEFAULT_RATE_LIMIT): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(providerKey);
    if (!bucket) {
      bucket = { tokens: maxRpm, lastRefill: now };
      this.buckets.set(providerKey, bucket);
    }
    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / ProviderHealthRegistry.RATE_WINDOW_MS) * maxRpm;
    bucket.tokens = Math.min(maxRpm, bucket.tokens + refill);
    bucket.lastRefill = now;
    // Consume one token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Returns the estimated wait time in ms before a token is available.
   * Used for backpressure — callers can delay scheduling instead of burning retries.
   */
  rateLimitWaitMs(providerKey: string, maxRpm = ProviderHealthRegistry.DEFAULT_RATE_LIMIT): number {
    let bucket = this.buckets.get(providerKey);
    if (!bucket) return 0;
    if (bucket.tokens >= 1) return 0;
    const tokenIntervalMs = ProviderHealthRegistry.RATE_WINDOW_MS / maxRpm;
    return Math.ceil((1 - bucket.tokens) * tokenIntervalMs);
  }

  /**
   * Get all provider health summaries for the dashboard.
   */
  getEntries(): Array<ProviderHealth & { provider: string; circuitState: string }> {
    return Array.from(this.samples.entries()).map(([name, samples]) => {
      const list = samples.slice(-200);
      const errors = list.filter((s) => !s.success).length;
      const rateLimits = list.filter((s) => s.rateLimited).length;
      const errorRate = list.length > 0 ? errors / list.length : 0;
      const rateLimitRate = list.length > 0 ? rateLimits / list.length : 0;
      const latencies = list
        .filter((s) => s.success && !s.rateLimited)
        .map((s) => s.latencyMs)
        .sort((a, b) => a - b);
      return {
        provider: name,
        latencyP50: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
        latencyP95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
        errorRate,
        rateLimitRate,
        recentCalls: list.length,
        score: this.getHealth(name).score,
        circuitState: this.getCircuitState(name),
      };
    });
  }
}

export interface ProviderHealth {
  latencyP50: number;
  latencyP95: number;
  errorRate: number;
  rateLimitRate: number;
  recentCalls: number;
  score: number;
}

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

  /** Load historical data from DB rows. */
  loadFromRows(rows: Array<{
    provider: string | null;
    model: string | null;
    resultStatus: string;
    costUsd: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>): void {
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

  getScore(key: string): PerfScore | undefined {
    const entry = this.cache.get(key);
    if (!entry || entry.total === 0) return undefined;

    const passRate = entry.passes / entry.total;
    const avgCost = entry.totalCost / entry.total;
    const avgDuration = entry.totalDuration / entry.total;

    // Wilson lower bound for 95% CI
    const n = entry.total;
    const z = 1.96;
    const phat = passRate;
    const wilson = (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);

    // Cost per pass rate (lower is better)
    const costPerPass = passRate > 0 ? avgCost / passRate : Infinity;

    // Recency decay — penalize entries not updated recently
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

  /** Get all cached scores. */
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

// ─── Task Classifier ────────────────────────────────────────────────────────

const CODE_KEYWORDS = ['fix', 'bug', 'implement', 'refactor', 'code', 'function', 'class', 'method', 'test', 'lint', 'type', 'error', 'exception', 'module', 'package', 'import', 'export', 'api', 'endpoint', 'route', 'schema', 'migration', 'deploy', 'ci', 'cd', 'git', 'commit', 'pr', 'diff', 'patch'];
const DATA_KEYWORDS = ['data', 'query', 'sql', 'database', 'table', 'column', 'row', 'csv', 'json', 'xml', 'parse', 'transform', 'etl', 'pipeline', 'sync', 'migrate', 'import', 'export', 'batch'];
const REASONING_KEYWORDS = ['analyze', 'reason', 'explain', 'compare', 'evaluate', 'assess', 'decide', 'plan', 'design', 'architect', 'strategy', 'approach', 'trade-off', 'pros', 'cons', 'why', 'how'];
const CREATIVE_KEYWORDS = ['write', 'draft', 'create', 'generate', 'design', 'ui', 'ux', 'layout', 'style', 'theme', 'brand', 'copy', 'content', 'blog', 'article', 'document', 'readme'];

const TOKEN_ESTIMATES: Record<Complexity, number> = {
  simple: 2000,
  medium: 8000,
  complex: 20000,
};

export function classifyTask(task: Task): TaskClassification {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();
  const words = text.split(/\s+/);

  // Domain classification by keyword density
  const domainScores: Record<TaskDomain, number> = { code: 0, data: 0, reasoning: 0, creative: 0, general: 0 };
  for (const word of words) {
    if (CODE_KEYWORDS.some((kw) => word.includes(kw))) domainScores.code++;
    if (DATA_KEYWORDS.some((kw) => word.includes(kw))) domainScores.data++;
    if (REASONING_KEYWORDS.some((kw) => word.includes(kw))) domainScores.reasoning++;
    if (CREATIVE_KEYWORDS.some((kw) => word.includes(kw))) domainScores.creative++;
  }
  domainScores.general = 1; // baseline

  const domain = (Object.entries(domainScores) as [TaskDomain, number][])
    .sort((a, b) => b[1] - a[1])[0]![0];

  // Required capabilities from tags
  const requiredCapabilities: string[] = [];
  if (task.tags.includes('tools') || task.tags.includes('code') || domain === 'code') requiredCapabilities.push('tools');
  if (task.tags.includes('vision')) requiredCapabilities.push('vision');
  if (task.complexity === 'complex' || words.length > 200) requiredCapabilities.push('long-context');

  return {
    complexity: task.complexity,
    domain,
    requiredCapabilities,
    estimatedTokens: TOKEN_ESTIMATES[task.complexity] ?? 8000,
  };
}

// ─── Scoring Weights by Strategy ────────────────────────────────────────────

interface StrategyWeights {
  capability: number;
  performance: number;
  cost: number;
  health: number;
  budget: number;
  recency: number;
}

const STRATEGY_WEIGHTS: Record<RoutingStrategy, StrategyWeights> = {
  balanced:              { capability: 0.25, performance: 0.25, cost: 0.20, health: 0.15, budget: 0.10, recency: 0.05 },
  'cost-optimized':      { capability: 0.15, performance: 0.15, cost: 0.40, health: 0.10, budget: 0.15, recency: 0.05 },
  'performance-optimized': { capability: 0.20, performance: 0.40, cost: 0.05, health: 0.15, budget: 0.10, recency: 0.10 },
  consensus:             { capability: 0.20, performance: 0.30, cost: 0.10, health: 0.20, budget: 0.10, recency: 0.10 },
  exploratory:           { capability: 0.15, performance: 0.15, cost: 0.15, health: 0.10, budget: 0.05, recency: 0.40 },
};

// ─── Capability Scoring ─────────────────────────────────────────────────────

const CAP_LEVEL: Record<CapabilityLevel, number> = { fast: 1, capable: 2, advanced: 3 };
const COMPLEXITY_LEVEL: Record<Complexity, number> = { simple: 1, medium: 2, complex: 3 };

function scoreCapability(cap: Capability, classification: TaskClassification): number {
  let score = CAP_LEVEL[cap.level];

  // Penalize under-powered models for complex tasks
  if (CAP_LEVEL[cap.level] < COMPLEXITY_LEVEL[classification.complexity]) {
    score -= 3;
  }

  // Bonus for matching required capabilities
  if (classification.requiredCapabilities.includes('tools') && cap.supportsTools) score += 2;
  if (classification.requiredCapabilities.includes('vision') && cap.supportsVision) score += 2;

  // Penalize missing required capabilities
  if (classification.requiredCapabilities.includes('tools') && !cap.supportsTools) score -= 5;
  if (classification.requiredCapabilities.includes('vision') && !cap.supportsVision) score -= 5;

  // Context window check for long-context tasks
  if (classification.requiredCapabilities.includes('long-context')) {
    if (cap.contextWindow && cap.contextWindow >= 32_000) score += 1;
    else if (cap.contextWindow && cap.contextWindow < 8_000) score -= 3;
  }

  return Math.max(0, Math.min(10, score));
}

// ─── Main Router ────────────────────────────────────────────────────────────

export class IntelligentRouter {
  readonly health = new ProviderHealthRegistry();
  readonly performance = new PerformanceCache();
  readonly strategyLearner = new StrategyLearner();
  private useCount = new Map<string, number>(); // for recency scoring

  /**
   * Select the best provider/model(s) for a task.
   */
  route(
    configs: ProviderConfig[],
    task: Task,
    options: IntelligentRouterOptions = {},
  ): RouteDecision | undefined {
    const {
      budgetUsd,
      maxCandidates = 3,
      minHistoricalRuns = 3,
      explorationRate = 0,
    } = options;

    // Let strategy learner recommend based on historical outcomes
    let strategy = options.strategy ?? 'balanced';
    const classification = classifyTask(task);
    const recommended = this.strategyLearner.recommend(classification.domain, classification.complexity);
    if (recommended && !options.strategy) {
      strategy = recommended;
    }

    const enabled = configs.filter((c) => c.enabled);
    if (enabled.length === 0) return undefined;

    // Honour explicit model pin
    if (task.assignedModel) {
      const provider = enabled.find(
        (c) => c.id === task.assignedModel!.provider || c.name === task.assignedModel!.provider,
      );
      if (provider) {
        return {
          primary: {
            provider,
            model: task.assignedModel.model,
            score: 10,
            breakdown: { capability: 10, performance: 0, cost: 0, health: 0, budget: 10, recency: 0, total: 10 },
          },
          fallbacks: [],
          taskClassification: classifyTask(task),
          strategy,
          reasoning: 'Explicit model pin on task',
        };
      }
    }

    const weights = STRATEGY_WEIGHTS[strategy];

    // Score every provider/model combination
    const candidates: RouteCandidate[] = [];

    for (const provider of enabled) {
      for (const cap of provider.capabilities) {
        const key = `${provider.name}/${cap.name}`;
        const perfScore = this.performance.getScore(key);
        const health = this.health.getHealth(provider.name);
        const capScore = scoreCapability(cap, classification);
        const useCount = this.useCount.get(key) ?? 0;

        // --- Score breakdown ---

        // Capability: 0-10
        const capability = capScore;

        // Performance: Wilson lower bound * 10, or 5 if no history
        let performance = 5;
        if (perfScore && perfScore.totalRuns >= minHistoricalRuns) {
          performance = perfScore.wilsonLowerBound * 10;
        }

        // Cost: inverse of cost-per-pass-rate, normalized to 0-10
        let cost = 5;
        if (perfScore && perfScore.costPerPass < Infinity) {
          // $0 → 10, $1 → 5, $5+ → 0
          cost = Math.max(0, 10 - perfScore.costPerPass * 10);
        }

        // Health: directly from health registry
        const healthScore = health.score;

        // Budget: 10 if under budget, 0 if over, 5 if no budget set
        let budget = 5;
        if (budgetUsd !== undefined && perfScore) {
          budget = perfScore.avgCostUsd <= budgetUsd ? 10 : 0;
        }

        // Recency: penalize heavily-used models to spread load
        // 0 uses → 10, 10+ uses → 2
        const recency = Math.max(2, 10 - useCount);

        // Weighted total
        const total =
          capability * weights.capability +
          performance * weights.performance +
          cost * weights.cost +
          healthScore * weights.health +
          budget * weights.budget +
          recency * weights.recency;

        // Exploration bonus: randomly boost unknown providers
        const explorationBonus = (explorationRate > 0 && (!perfScore || perfScore.totalRuns < minHistoricalRuns))
          ? Math.random() * explorationRate * 5
          : 0;

        candidates.push({
          provider,
          model: cap.name,
          score: total + explorationBonus,
          breakdown: {
            capability,
            performance,
            cost,
            health: healthScore,
            budget,
            recency,
            total: total + explorationBonus,
          },
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return undefined;

    const primary = candidates[0]!;
    const fallbacks = candidates.slice(1, maxCandidates + 1);

    // Build reasoning string
    const parts: string[] = [];
    parts.push(`strategy=${strategy}`);
    parts.push(`domain=${classification.domain}`);
    parts.push(`complexity=${classification.complexity}`);
    if (budgetUsd !== undefined) parts.push(`budget=$${budgetUsd}`);
    if (primary.breakdown.performance > 0) {
      parts.push(`perf=${primary.breakdown.performance.toFixed(1)}`);
    }
    if (primary.breakdown.cost > 0) {
      parts.push(`cost=${primary.breakdown.cost.toFixed(1)}`);
    }

    // Track use count for recency
    const usedKey = `${primary.provider.name}/${primary.model}`;
    this.useCount.set(usedKey, (this.useCount.get(usedKey) ?? 0) + 1);

    return {
      primary,
      fallbacks,
      taskClassification: classification,
      strategy,
      reasoning: parts.join(' · '),
    };
  }

  /**
   * Get a ranked list of all providers for display/preview.
   */
  rankAll(
    configs: ProviderConfig[],
    task: Task,
    options: IntelligentRouterOptions = {},
  ): RouteCandidate[] {
    const enabled = configs.filter((c) => c.enabled);
    const classification = classifyTask(task);
    const weights = STRATEGY_WEIGHTS[strategy(options.strategy)];
    const candidates: RouteCandidate[] = [];

    for (const provider of enabled) {
      for (const cap of provider.capabilities) {
        const key = `${provider.name}/${cap.name}`;
        const perfScore = this.performance.getScore(key);
        const health = this.health.getHealth(provider.name);
        const capScore = scoreCapability(cap, classification);

        const capability = capScore;
        let performance = 5;
        if (perfScore && perfScore.totalRuns >= (options.minHistoricalRuns ?? 3)) {
          performance = perfScore.wilsonLowerBound * 10;
        }
        let cost = 5;
        if (perfScore && perfScore.costPerPass < Infinity) {
          cost = Math.max(0, 10 - perfScore.costPerPass * 10);
        }
        const healthScore = health.score;
        let budget = 5;
        if (options.budgetUsd !== undefined && perfScore) {
          budget = perfScore.avgCostUsd <= options.budgetUsd ? 10 : 0;
        }
        const total =
          capability * weights.capability +
          performance * weights.performance +
          cost * weights.cost +
          healthScore * weights.health +
          budget * weights.budget +
          5 * weights.recency;

        candidates.push({
          provider,
          model: cap.name,
          score: total,
          breakdown: { capability, performance, cost, health: healthScore, budget, recency: 5, total },
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }
}

function strategy(s?: string): RoutingStrategy {
  if (s === 'cost-optimized' || s === 'performance-optimized' || s === 'consensus' || s === 'exploratory') return s;
  return 'balanced';
}

// ─── Persistence ────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

interface PersistedRouterState {
  version: 2;
  savedAt: string;
  health: Record<string, Array<Omit<HealthSample, 'timestamp'> & { timestamp: number }>>;
  performance: Record<string, PerfEntry>;
  strategyScores: Record<string, { wins: number; total: number; avgScore: number }>;
  circuits: Record<string, { state: string; openedAt: number; cooldownUntil: number; trialInFlight: boolean }>;
}

const DEFAULT_PERSIST_PATH = join(process.env.HOME ?? '~', '.omega', 'router-state.json');

export async function saveRouterState(router: IntelligentRouter, path?: string): Promise<void> {
  const filePath = path ?? DEFAULT_PERSIST_PATH;
  const state: PersistedRouterState = {
    version: 2,
    savedAt: new Date().toISOString(),
    health: Object.fromEntries([...router.health['samples'].entries()]),
    performance: Object.fromEntries([...router.performance['cache'].entries()].map(([k, v]) => [k, v])),
    strategyScores: Object.fromEntries([...router.strategyLearner.scores.entries()]),
    circuits: Object.fromEntries([...router.health['circuits'].entries()]),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

export async function loadRouterState(router: IntelligentRouter, path?: string): Promise<boolean> {
  const filePath = path ?? DEFAULT_PERSIST_PATH;
  try {
    const raw = await readFile(filePath, 'utf-8');
    const state = JSON.parse(raw) as PersistedRouterState;
    if (state.version < 1 || state.version > 2) return false;

    // Restore health samples
    for (const [key, samples] of Object.entries(state.health)) {
      for (const sample of samples) {
        router.health.record(key, sample);
      }
    }

    // Restore performance cache
    for (const [key, entry] of Object.entries(state.performance)) {
      router.performance['cache'].set(key, entry);
    }

    // Restore strategy scores
    for (const [key, score] of Object.entries(state.strategyScores)) {
      router.strategyLearner.scores.set(key, score);
    }

    // Restore circuit breaker states (v2+)
    if (state.version >= 2 && state.circuits) {
      for (const [key, circuit] of Object.entries(state.circuits)) {
        router.health['circuits'].set(key, circuit as { state: 'closed' | 'open' | 'half-open'; openedAt: number; cooldownUntil: number; trialInFlight: boolean });
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ─── Strategy Learning ──────────────────────────────────────────────────────

interface StrategyScore {
  wins: number;
  total: number;
  avgScore: number;
}

/**
 * Tracks which routing strategy performs best for each task domain/complexity
 * combination. After enough data, automatically adjusts the strategy weights
 * to favor what works.
 */
export class StrategyLearner {
  /** key = "${domain}:${complexity}" */
  scores = new Map<string, StrategyScore>();

  /**
   * Record the outcome of a routing decision.
   */
  recordOutcome(
    domain: TaskDomain,
    complexity: Complexity,
    strategy: RoutingStrategy,
    passed: boolean,
    costUsd: number,
  ): void {
    const key = `${domain}:${complexity}`;
    const existing = this.scores.get(key) ?? { wins: 0, total: 0, avgScore: 0 };
    existing.total++;
    if (passed) existing.wins++;
    // Exponential moving average of "goodness" (pass - normalized cost)
    const goodness = (passed ? 1 : 0) - Math.min(1, costUsd * 10);
    existing.avgScore = existing.avgScore * 0.9 + goodness * 0.1;
    this.scores.set(key, existing);
  }

  /**
   * Recommend a strategy for a given task based on historical outcomes.
   */
  recommend(domain: TaskDomain, complexity: Complexity): RoutingStrategy | undefined {
    // Need at least 5 data points before recommending
    const key = `${domain}:${complexity}`;
    const score = this.scores.get(key);
    if (!score || score.total < 5) return undefined;

    // If performance-optimized tasks have higher avgScore, recommend it
    // This is a simple heuristic; more sophisticated approaches could
    // track per-strategy scores separately
    if (score.avgScore > 0.3 && score.wins / score.total > 0.7) {
      return 'performance-optimized';
    }
    if (score.avgScore < -0.1) {
      return 'cost-optimized';
    }
    return undefined;
  }

  /**
   * Get all scores as an array for display.
   */
  getStats(): Array<{ domain: string; complexity: string; wins: number; total: number; passRate: number; avgScore: number }> {
    return Array.from(this.scores.entries()).map(([key, s]) => {
      const [domain, complexity] = key.split(':');
      return {
        domain,
        complexity,
        wins: s.wins,
        total: s.total,
        passRate: s.total > 0 ? s.wins / s.total : 0,
        avgScore: s.avgScore,
      };
    });
  }
}
