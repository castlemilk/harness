export interface BenchmarkTask {
  id: string;
  name: string;
  title: string;
  description?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  setup?: (projectPath: string) => Promise<void>;
  evaluate: (ctx: EvaluationContext) => Promise<BenchmarkEvaluation>;
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

export interface BenchmarkResult {
  task: BenchmarkTask;
  harnessTaskId: string;
  durationMs: number;
  status: 'done' | 'failed' | 'timeout';
  evaluation: BenchmarkEvaluation;
  agentRun?: AgentRunInfo;
  spanCount: number;
}

export interface BenchmarkReport {
  timestamp: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  totalDurationMs: number;
  results: BenchmarkResult[];
}
