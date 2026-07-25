export * from './rules.js';
export * from './tiers.js';
export { selectProviderWithHistory, getHistoricalScores, type HistoricalScore, type DifficultyAwareOptions } from './difficulty-aware.js';
export {
  IntelligentRouter,
  StrategyLearner,
  classifyTask,
  saveRouterState,
  loadRouterState,
  type RoutingStrategy,
  type RouteDecision,
  type RouteCandidate,
  type ScoreBreakdown,
  type TaskClassification,
  type TaskDomain,
  type IntelligentRouterOptions,
  type ProviderHealth,
  type PerfScore,
} from './intelligent.js';
