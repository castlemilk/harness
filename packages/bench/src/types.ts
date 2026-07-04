export interface BenchmarkTask {
  id: string;
  name: string;
  title: string;
  description?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  setup?: (projectPath: string) => Promise<void>;
  evaluate: (ctx: EvaluationContext) => BenchmarkEvaluation | Promise<BenchmarkEvaluation>;
}

export interface EvaluationContext {
  apiUrl: string;
  taskId: string;
  projectPath: string;
  projectId: string;
  agentRun?: AgentRunInfo;
  diffs: DiffInfo[];
  traceFlow?: TraceFlowInfo;
}

export interface BenchmarkEvaluation {
  passed: boolean;
  score?: number;
  message?: string;
  metrics?: Record<string, number | string>;
}

export interface AgentRunInfo {
  id: string;
  resultStatus: string;
  validationSummary?: string;
  publishedVersion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiffInfo {
  id: string;
  branch: string;
  patch: string;
}

export interface TraceFlowInfo {
  traceId?: string;
  spans: TraceSpanNode[];
}

export interface TraceSpanNode {
  name: string;
  status: string;
  startTime: string;
  endTime?: string;
  attributes?: Record<string, unknown>;
  children: TraceSpanNode[];
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  harnessTaskId: string;
  durationMs: number;
  status: 'done' | 'failed' | 'timeout';
  evaluation: BenchmarkEvaluation;
  agentRun?: AgentRunInfo;
  spanCount: number;
  failureAnalysis?: FailureAnalysis;
  usage?: UsageInfo;
}

export interface BenchmarkReport {
  timestamp: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  totalDurationMs: number;
  totalUsage?: UsageInfo;
  results: BenchmarkResult[];
}

export type FailureCategory =
  | 'timeout'
  | 'validation_failure'
  | 'tool_misuse'
  | 'parse_error'
  | 'plan_error'
  | 'unknown';

export interface FailureAnalysis {
  category: FailureCategory;
  rootCause: string;
  evidence: string[];
}
