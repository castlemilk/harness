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
import { ProviderHealthRegistry } from './health-registry.js';
import { PerformanceCache } from './performance-cache.js';
import { StrategyLearner } from './strategy-learner.js';

export { ProviderHealthRegistry };
export { PerformanceCache };
export { StrategyLearner };
export type { ProviderHealth } from './health-registry.js';
export type { PerfScore } from './performance-cache.js';

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
    .sort((a, b) => b[1] - a[1])[0][0];

  // Required capabilities from tags
  const requiredCapabilities: string[] = [];
  if (task.tags.includes('tools') || task.tags.includes('code') || domain === 'code') requiredCapabilities.push('tools');
  if (task.tags.includes('vision')) requiredCapabilities.push('vision');
  if (task.complexity === 'complex' || words.length > 200) requiredCapabilities.push('long-context');

  return {
    complexity: task.complexity,
    domain,
    requiredCapabilities,
    estimatedTokens: TOKEN_ESTIMATES[task.complexity],
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
      explorationRate: rawExplorationRate = 0,
    } = options;
    const explorationRate = Math.max(0, Math.min(1, rawExplorationRate));

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
      const am = task.assignedModel;
      const provider = enabled.find(
        (c) => c.id === am.provider || c.name === am.provider,
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

    const primary = candidates[0];
    const fallbacks = candidates.slice(1, maxCandidates + 1);

    // Build reasoning string
    const parts: string[] = [];
    parts.push(`strategy=${strategy}`);
    parts.push(`domain=${classification.domain}`);
    parts.push(`complexity=${classification.complexity}`);
    if (budgetUsd !== undefined) parts.push(`budget=$${String(budgetUsd)}`);
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

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

interface PersistedRouterState {
  version: 2;
  savedAt: string;
  health: Record<string, { timestamp: number; latencyMs: number; success: boolean; rateLimited: boolean; costUsd: number }[]>;
  performance: Record<string, { passes: number; total: number; totalCost: number; totalDuration: number; lastUpdated: number }>;
  strategyScores: Record<string, { wins: number; total: number; avgScore: number }>;
  circuits?: Record<string, { state: string; openedAt: number; cooldownUntil: number; trialInFlight: boolean; consecutiveSuccesses?: number }>;
}

const DEFAULT_PERSIST_PATH = join(process.env.HOME ?? '~', '.omega', 'router-state.json');

export async function saveRouterState(router: IntelligentRouter, path?: string): Promise<void> {
  const filePath = path ?? DEFAULT_PERSIST_PATH;
  const state: PersistedRouterState = {
    version: 2,
    savedAt: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/dot-notation
    health: Object.fromEntries([...router.health['samples'].entries()]),
    // eslint-disable-next-line @typescript-eslint/dot-notation
    performance: Object.fromEntries([...router.performance['cache'].entries()].map(([k, v]) => [k, v])),
    strategyScores: Object.fromEntries([...router.strategyLearner.scores.entries()]),
    // eslint-disable-next-line @typescript-eslint/dot-notation
    circuits: Object.fromEntries([...router.health['circuits'].entries()]),
  };
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${String(process.pid)}`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2));
  await rename(tmpPath, filePath);
}

export async function loadRouterState(router: IntelligentRouter, path?: string): Promise<boolean> {
  const filePath = path ?? DEFAULT_PERSIST_PATH;
  try {
    const raw = await readFile(filePath, 'utf-8');
    const state = JSON.parse(raw) as PersistedRouterState;
    // Restore health samples with original timestamps
    for (const [key, samples] of Object.entries(state.health)) {
      for (const sample of samples) {
        router.health.restoreSample(key, sample);
      }
    }

    // Restore performance cache
    for (const [key, entry] of Object.entries(state.performance)) {
      // eslint-disable-next-line @typescript-eslint/dot-notation
      router.performance['cache'].set(key, entry);
    }

    // Restore strategy scores
    for (const [key, score] of Object.entries(state.strategyScores)) {
      router.strategyLearner.scores.set(key, score);
    }

    // Restore circuit breaker states (v2+) with validation
    const validStates = new Set(['closed', 'open', 'half-open']);
    for (const [key, circuit] of Object.entries(state.circuits ?? {})) {
      if (!validStates.has(circuit.state)) {
        circuit.state = 'closed';
      }
      // eslint-disable-next-line @typescript-eslint/dot-notation
      router.health['circuits'].set(key, circuit as { state: 'closed' | 'open' | 'half-open'; openedAt: number; cooldownUntil: number; trialInFlight: boolean; consecutiveSuccesses?: number });
    }

    return true;
  } catch {
    return false;
  }
}
