export * from './types.js';
export * from './api-client.js';
export { runBenchmark } from './runner.js';
export { writeReport, printSummary } from './report.js';
export { compareReports, writeCompareReport } from './compare.js';
export { generateTrend, formatTrend, type TrendEntry, type TrendOptions } from './trend.js';
export { syntheticSuite } from './suites/synthetic.js';
export { fastSuite } from './suites/fast.js';
export { deepSuite } from './suites/deep.js';
export { hardSuite, HARD_DEEPSWE_TASK_IDS } from './suites/hard.js';
export { harderSuite } from './suites/harder.js';
export { harderV2Suite } from './suites/harder-v2.js';
export { hardTargetedSuite } from './suites/hard-targeting.js';
export { loadSuiteTasks, SUITES_BY_MODE, type SuiteLoadOptions, type SuiteMode } from './suites/loader.js';
export { runModelEval, runHarnessEval, writeModelEvalReport, summarizeModelEval, parseModelList, type ModelEvalModel, type ModelEvalResult, type ModelEvalSummary, type HarnessEvalOptions } from './model-eval.js';
export { runConsensusEval, type ConsensusModel, type ConsensusOptions, type ConsensusResult, type ConsensusTaskReport, type ConsensusSummary } from './consensus.js';
export { runStrategyEval, analyseFailures, classifyTask, STRATEGY_PROMPTS, type StrategyName, type StrategyOptions, type StrategyResult, type StrategyTaskReport, type StrategyCandidate, type StrategySummary, type FailureInsight } from './strategy-eval.js';
export { generateAdversarialTests, saveAdversarialTasks, loadAdversarialTasks, type AdversarialGenOptions, type AdversarialTask } from './adversarial.js';
export { loadDeepSWESuite, type DeepSWEOptions } from './adapters/deepswe.js';
export { loadSWebenchLiteSuite, type SWebenchOptions } from './adapters/swebench.js';
export { loadPierSuite, runPierBenchmark, type PierOptions } from './adapters/pier.js';
export {
  buildOptimisePrompt,
  loadOptimisationContext,
  submitOptimiseTask,
  type OptimiseOptions,
} from './optimise.js';
export { classifyFailure, pickFocusResult, summariseFailures, scoreByPromptVersion, type PromptVersionScore } from './analyse.js';
export { runVarianceEval, printVarianceSummary, type VarianceTaskResult, type VarianceReport, type RunVarianceOptions } from './variance.js';
export {
  BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS,
  saveBenchmarkHistory,
  getHistoryBySuite,
  getCostPerPassRate,
  getPassRateTrend,
  type BenchmarkHistoryEntry,
  type CostPerPassRate,
} from './history.js';
